import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Ai } from "../agent/models.ts";
import { AiSizeError } from "../agent/usage.ts";
import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { ChatMessage, Job, Topic } from "../types.ts";
import { contextWithin, messageChunks, transcript } from "./messages.ts";

export class Notes {
  #config: Config;
  #store: Store;
  #ai: Ai;

  constructor(config: Config, store: Store, ai: Ai) {
    this.#config = config;
    this.#store = store;
    this.#ai = ai;
  }

  public async schedule(topic: Topic, requested = false): Promise<void> {
    if (!topic.lastSourceId || topic.generation === topic.noteGeneration) {
      return;
    }

    await this.#store.jobs.enqueue(
      "summarize",
      `summarize:${topic.id}:${topic.generation}`,
      {
        groupId: topic.groupId,
        topicId: topic.id,
        through: topic.lastSourceId,
        generation: topic.generation,
        requested,
      },
    );
  }

  async #summarize(title: string, chunk: ChatMessage[]): Promise<string> {
    try {
      return await this.#ai.summarize(title, chunk);
    } catch (error) {
      if (!(error instanceof AiSizeError)) {
        throw error;
      }

      if (chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);

        return `${await this.#summarize(title, chunk.slice(0, middle))}\n\n${await this.#summarize(title, chunk.slice(middle))}`;
      }

      const item = chunk[0]!;

      if (item.text.length < 512) {
        throw error;
      }

      const middle = Math.ceil(item.text.length / 2);

      return `${await this.#summarize(title, [{ ...item, text: item.text.slice(0, middle) }])}\n\n${await this.#summarize(title, [{ ...item, text: item.text.slice(middle) }])}`;
    }
  }

  public async generate(job: Job<"summarize">): Promise<void> {
    const topic = await this.#store.topic(job.payload.topicId);
    const generation = job.payload.generation;

    if (generation < topic.generation) {
      return;
    }

    const sources = await this.#store.topicMessages(
      topic.id,
      job.payload.through,
    );
    let note = await this.#store.latestNote(topic.id);

    if (note?.generation !== generation) {
      const chunks = await messageChunks(
        this.#store,
        sources,
        Math.floor(this.#config.AI_INPUT_CHARS / 4),
      );
      const sections: string[] = [];

      for (const chunk of chunks) {
        sections.push(await this.#summarize(topic.title, chunk));
      }

      const revision = topic.revision + 1;
      const directory = join(
        this.#store.directory,
        "groups",
        topic.groupId,
        "topics",
        topic.id,
        `v${revision}`,
      );

      await mkdir(directory, { recursive: true });
      const markdown = `# ${topic.title}\n\n第 ${revision} 版 · ${sources.length} 条原始消息\n\n${sections.join("\n\n")}\n\n[查看完整原始记录](transcript.md)。\n`;
      const files: [string, string][] = [
        ["note.md", markdown],
        ["transcript.md", await transcript(this.#store, sources)],
      ];

      for (const [filename, content] of files) {
        const temporary = join(directory, `${filename}.${randomUUID()}.part`);

        await writeFile(temporary, content, { mode: 0o600 });
        await rename(temporary, join(directory, filename));
      }

      note = await this.#store.saveNote(
        topic.id,
        sources.at(-1)!.id,
        generation,
        markdown,
        join(directory, "note.md"),
        Date.now(),
      );
    }

    await this.#store.deliveries.enqueue(
      `ack:${note.id}`,
      topic.groupId,
      topic.id,
      note.id,
      "text",
      `「${topic.title}」已保存在本地，第 ${note.revision} 版，共 ${sources.length} 条原文。`,
    );

    let publish = topic.directive === "send";

    if (topic.directive === "auto") {
      const directiveMessage =
        topic.directiveMessageId === null
          ? []
          : [await this.#store.message(topic.directiveMessageId)];
      const context = await contextWithin(
        this.#store,
        [
          ...new Map(
            [
              ...sources.slice(-10),
              ...(await this.#store.recent(topic.groupId, 30)),
              ...directiveMessage,
            ].map((message) => [message.id, message]),
          ).values(),
        ].sort((a, b) => a.id - b.id),
        Math.floor(this.#config.AI_INPUT_CHARS * 0.65),
      );

      publish = await this.#ai.shouldPublish(
        topic,
        {
          revision: note.revision,
          sources: sources.length,
        },
        context,
      );
    }

    if (publish) {
      await this.#store.deliveries.enqueue(
        `auto-note:${note.id}`,
        topic.groupId,
        topic.id,
        note.id,
        "note",
        note.markdown,
      );
    }
  }
}
