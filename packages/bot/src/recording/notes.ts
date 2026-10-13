import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { Logger } from "@koishijs/core";

import type { Ai } from "../agent/ai.ts";
import type { Config } from "../config.ts";
import { topicDirectory, writeMarkdown } from "../storage/files.ts";
import type { Store } from "../storage/store.ts";
import type { Job, Note, Topic } from "../types.ts";
import { publishNote } from "./publication.ts";
import { Summarizer } from "./summary.ts";
import { transcript } from "./transcript.ts";

export class Notes {
  #config: Config;
  #store: Store;
  #ai: Ai;
  #summary: Summarizer;
  #logger = new Logger("yanqi:notes");

  constructor(config: Config, store: Store, ai: Ai) {
    this.#config = config;
    this.#store = store;
    this.#ai = ai;
    this.#summary = new Summarizer(config, store, ai);
  }

  public async arrange(topic: Topic, requestId: number) {
    const note = await this.#store.notes.find(topic.id);
    const record = { topicId: topic.id, title: topic.title };

    if (note?.generation === topic.generation) {
      if (topic.directive === "send") {
        await this.#store.deliveries.enqueue(
          `requested:${requestId}:${topic.id}`,
          { kind: "note", note, repeat: true },
        );
      }

      return {
        ...record,
        revision: note.revision,
        path: note.path,
        state: topic.directive === "send" ? "sending" : "saved",
      };
    }

    const taskId = await this.#store.jobs.summarize(topic, true);

    return {
      ...record,
      taskId,
      state: taskId === null ? "empty" : "processing",
      pendingRevision: taskId === null ? null : topic.revision + 1,
    };
  }

  public async generate(job: Job<"summarize">): Promise<void> {
    const { topicId, requested } = job.payload;
    const topic = await this.#store.topics.get(topicId);
    const generation = topic.generation;

    if (!topic.lastSourceId) {
      return;
    }

    let note = await this.#store.notes.find(topic.id);
    const sources = await this.#store.topics.messages(
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
        topicDirectory(this.#store.directory, topic),
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
      const footer = "[查看完整原文](transcript.md)\n";
      let sections: Note["sections"] = [];
      let content = "";
      let excerpt = "";

      for await (const progress of this.#summary.sections(
        topic,
        sources,
        note,
      )) {
        sections = progress.sections;
        content = sections
          .map((section) => section.content)
          .filter(Boolean)
          .join("\n\n");
        const outline = content
          .split("\n")
          .filter((line) => /^#{2,3} |^\*\*/.test(line))
          .join("；");

        excerpt = (outline || content).slice(0, 600);
        await writeMarkdown(
          path,
          `${header}\n\n> 草稿：整理尚未完成。\n\n${content}\n\n${footer}`,
        );
        await this.#store.jobs.reportProgress(
          job.id,
          `共 ${sources.length} 条原文，已提取 ${progress.completed}/${progress.total} 批。${excerpt ? `已整理内容摘录：${excerpt}。` : ""}草稿：${path}`,
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
        `正在合并相关观点。${excerpt ? `已整理内容摘录：${excerpt}。` : ""}草稿：${path}`,
      );
      content = await this.#summary.compose(sections);
      const markdown = `${header}\n\n${content || "所选原文中没有找到与整理要求相关的内容。"}\n\n${footer}`;

      await writeMarkdown(path, markdown);
      note = await this.#store.notes.save(
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
        `第 ${note.revision} 版已保存：${path}${excerpt ? `。已整理内容摘录：${excerpt}` : ""}`,
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

    if (job.payload.publish === false) {
      return;
    }

    await publishNote(
      this.#config,
      this.#store,
      this.#ai,
      note,
      sources,
      requested,
    );
  }
}
