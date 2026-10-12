import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Logger } from "koishi";

import type { Ai } from "../agent/models.ts";
import { AiSizeError } from "../agent/usage.ts";
import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { ChatMessage, Job, Message, Note, Topic } from "../types.ts";
import { contextWithin, messageChunks } from "./messages.ts";
import { transcript } from "./transcript.ts";

async function writeMarkdown(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.part`;

  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

export class Notes {
  #config: Config;
  #store: Store;
  #ai: Ai;
  #logger = new Logger("yanqi:notes");

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
        requested,
      },
    );
  }

  async #summarize(
    topic: Topic,
    chunk: ChatMessage[],
    context: ChatMessage[],
  ): Promise<string> {
    try {
      return await this.#ai.summarize(topic, chunk, context);
    } catch (error) {
      if (!(error instanceof AiSizeError)) {
        throw error;
      }

      let parts: ChatMessage[][];

      if (chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);

        parts = [chunk.slice(0, middle), chunk.slice(middle)];
      } else {
        const item = chunk[0]!;

        if (item.text.length < 512) {
          throw error;
        }

        const middle = Math.ceil(item.text.length / 2);

        parts = [
          [{ ...item, text: item.text.slice(0, middle) }],
          [{ ...item, text: item.text.slice(middle) }],
        ];
      }

      const content: string[] = [];

      for (const part of parts) {
        content.push(await this.#summarize(topic, part, context));
      }

      return content.filter(Boolean).join("\n\n");
    }
  }

  async *#summarizeSections(
    topic: Topic,
    sources: Message[],
    previous: Note | null,
  ): AsyncGenerator<{
    sections: Note["sections"];
    completed: number;
    total: number;
  }> {
    const sourceIds = new Set(sources.map((message) => message.id));
    const changed = await this.#store.changedTopicMessages(
      topic.id,
      previous?.generation ?? -1,
    );
    const sections = (previous?.sections ?? []).filter(
      (section) =>
        section.messageIds.length > 0 &&
        section.messageIds.every((id) => sourceIds.has(id) && !changed.has(id)),
    );
    const budget = Math.floor(this.#config.AI_INPUT_CHARS / 4);
    const contextFor = async (chunk: ChatMessage[]) => {
      const ids = new Set(chunk.map((message) => message.id));
      const first = Number(chunk[0]!.id.slice(1));
      const quotes = new Set(
        chunk
          .map((message) => message.replyTo)
          .filter(
            (id): id is string =>
              id !== null && id.startsWith("m") && !ids.has(id),
          ),
      );
      const context = [
        ...sources.filter((message) => message.id < first).slice(-3),
        ...(await Promise.all(
          [...quotes].map((id) => this.#store.message(Number(id.slice(1)))),
        )),
      ];

      return contextWithin(
        this.#store,
        [...new Map(context.map((message) => [message.id, message])).values()],
        Math.floor(this.#config.AI_INPUT_CHARS / 6),
      );
    };

    const recorded = new Set(sections.flatMap((section) => section.messageIds));
    const added = sources.filter((message) => !recorded.has(message.id));
    const additions: Note["sections"] = [];
    const chunks = await messageChunks(this.#store, added, budget);

    yield { sections, completed: 0, total: chunks.length };

    // 每段只依赖原文，可以同时整理；按原文顺序写入，最多同时调用两次 AI。
    for (let index = 0; index < chunks.length; index += 2) {
      const results = await Promise.allSettled(
        chunks.slice(index, index + 2).map(async (chunk, offset) => {
          this.#logger.info(
            "整理进度：topic=%s batch=%s/%s",
            topic.id,
            index + offset + 1,
            chunks.length,
          );

          return {
            messageIds: [
              ...new Set(chunk.map((message) => Number(message.id.slice(1)))),
            ],
            content: await this.#summarize(
              topic,
              chunk,
              await contextFor(chunk),
            ),
          };
        }),
      );

      for (const result of results) {
        if (result.status === "rejected") {
          throw result.reason;
        }

        additions.push(result.value);
      }

      yield {
        sections: [...sections, ...additions].sort(
          (a, b) => a.messageIds[0]! - b.messageIds[0]!,
        ),
        completed: Math.min(index + 2, chunks.length),
        total: chunks.length,
      };
    }
  }

  async #compose(sections: Note["sections"]): Promise<string> {
    const paragraphs = sections
      .map((section) => section.content)
      .filter(Boolean);
    const budget = Math.floor(this.#config.AI_INPUT_CHARS / 3);
    const chapters: string[] = [];
    let batch: string[] = [];

    const merge = async () => {
      if (batch.length === 0) {
        return;
      }

      chapters.push(
        batch.length === 1 ? batch[0]! : await this.#ai.merge(batch),
      );
      batch = [];
    };

    // 汇总也分批，避免长历史在最后一步又塞进单次模型调用。
    for (const paragraph of paragraphs) {
      if (JSON.stringify([...batch, paragraph]).length > budget) {
        await merge();
      }

      batch.push(paragraph);
    }

    await merge();

    return chapters.join("\n\n");
  }

  public async generate(job: Job<"summarize">): Promise<void> {
    const { topicId, requested } = job.payload;
    let topic = await this.#store.topic(topicId);
    const generation = topic.generation;

    if (!topic.lastSourceId) {
      return;
    }

    let note = await this.#store.latestNote(topic.id);
    const sources = await this.#store.topicMessages(
      topic.id,
      topic.lastSourceId,
    );

    if (note?.generation === generation) {
      this.#logger.debug(
        "复用纪要 #%s：topic=%s revision=%s",
        note.id,
        topic.id,
        note.revision,
      );
    } else {
      this.#logger.info(
        "开始整理：topic=%s sources=%s focused=%s",
        topic.id,
        sources.length,
        Boolean(topic.focus),
      );
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
      await writeMarkdown(
        join(directory, "transcript.md"),
        await transcript(this.#store, sources, directory),
      );
      const path = join(directory, "note.md");
      const scope = topic.focus
        ? `检索范围共 ${sources.length} 条原始消息\n\n整理要求：${topic.focus}`
        : `${sources.length} 条原始消息`;
      const header = `# ${topic.title}\n\n第 ${revision} 版 · ${scope}`;
      const footer = "[查看范围内的完整原始记录](transcript.md)。\n";
      let sections: Note["sections"] = [];
      let content = "";

      for await (const progress of this.#summarizeSections(
        topic,
        sources,
        note,
      )) {
        sections = progress.sections;
        content = sections
          .map((section) => section.content)
          .filter(Boolean)
          .join("\n\n");
        await writeMarkdown(
          path,
          `${header}\n\n> 草稿：纪要尚未完成，以下是已整理的部分。\n\n${content}\n\n${footer}`,
        );
        await this.#store.jobs.reportProgress(
          job.id,
          `已提取 ${progress.completed}/${progress.total} 批；草稿：${path}`,
        );
        this.#logger.info(
          "纪要草稿已更新：topic=%s sections=%s file=%s",
          topic.id,
          sections.length,
          path,
        );
      }

      await this.#store.jobs.reportProgress(
        job.id,
        `正在合并相关观点；草稿：${path}`,
      );
      content = await this.#compose(sections);
      const markdown = `${header}\n\n${content || "在这些已保存的讨论中，没有找到与整理要求相关的内容。"}\n\n${footer}`;

      await writeMarkdown(path, markdown);
      note = await this.#store.saveNote(
        topic.id,
        sources.at(-1)!.id,
        generation,
        markdown,
        sections,
        path,
        Date.now(),
      );
      await this.#store.jobs.reportProgress(
        job.id,
        `第 ${note.revision} 版已保存：${path}`,
      );
      this.#logger.info(
        "纪要 #%s 已保存：group=%s topic=%s revision=%s sources=%s file=%s",
        note.id,
        topic.groupId,
        topic.id,
        note.revision,
        sources.length,
        note.path,
      );
    }

    // 整理期间仍能处理群请求，发送要求可能已经改变。
    topic = await this.#store.topic(topicId);
    let action: "send" | "notify" | "silent" =
      topic.directive === "send" ? "send" : "notify";

    if (
      topic.directive === "auto" ||
      (topic.directive === "hold" && !requested)
    ) {
      const request =
        topic.directiveMessageId === null
          ? []
          : [await this.#store.message(topic.directiveMessageId)];
      const context = await contextWithin(
        this.#store,
        sources.filter((message) => !message.command).slice(-10),
        Math.floor(this.#config.AI_INPUT_CHARS / 3),
      );

      const recent = await contextWithin(
        this.#store,
        await this.#store.conversation(
          topic.groupId,
          20,
          Number.MAX_SAFE_INTEGER,
        ),
        Math.floor(this.#config.AI_INPUT_CHARS / 3),
      );

      action = await this.#ai.choosePublication(
        topic,
        {
          revision: note.revision,
          sources: sources.length,
          requested,
        },
        context,
        await contextWithin(
          this.#store,
          request,
          Math.floor(this.#config.AI_INPUT_CHARS / 6),
        ),
        recent,
      );
      topic = await this.#store.topic(topicId);
      if (topic.directive === "send") {
        action = "send";
      } else if (topic.directive === "hold" && action === "send") {
        action = requested ? "notify" : "silent";
      }
    }

    // 新消息、撤回或结束记录可能改变原文范围；已完成的段落留在数据库中复用。
    if (topic.generation !== note.generation) {
      await this.schedule(topic, requested);
      this.#logger.info(
        "原文已更新，继续整理后再通知：topic=%s revision=%s",
        topic.id,
        note.revision,
      );

      return;
    }

    this.#logger.info(
      "纪要 #%s 发布决定：directive=%s action=%s",
      note.id,
      topic.directive,
      action,
    );

    if (action === "send") {
      await this.#store.deliveries.enqueue(`auto-note:${note.id}`, {
        kind: "note",
        note,
      });
    } else if (action === "notify") {
      await this.#store.deliveries.enqueue(`ack:${note.id}`, {
        kind: "saved",
        note,
        content: await this.#ai.voice(
          topic.groupId,
          `「${topic.title}」第 ${note.revision} 版已保存。`,
        ),
      });
    }
  }
}
