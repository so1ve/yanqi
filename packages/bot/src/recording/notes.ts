import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { Logger } from "@koishijs/core";

import type { Ai } from "../agent/ai.ts";
import { topicDirectory, writeMarkdown } from "../storage/files.ts";
import type { Store } from "../storage/store.ts";
import { waitForAsset } from "../tasks/assets.ts";
import type { Job, Topic } from "../types.ts";
import { noteImages } from "./images.ts";
import { Summarizer } from "./summary.ts";
import { transcript } from "./transcript.ts";

export class Notes {
  #store: Store;
  #summary: Summarizer;
  #logger = new Logger("yanqi:notes");
  #signal: AbortSignal;

  constructor(store: Store, ai: Ai, signal: AbortSignal) {
    this.#store = store;
    this.#summary = new Summarizer(store, ai);
    this.#signal = signal;
  }

  public async arrange(
    topic: Topic,
    requestId: number,
    replyTo: string | null = null,
  ) {
    topic = await this.#store.topics.promote(topic.id);
    const note = await this.#store.notes.find(topic.id);
    const record = {
      topicId: topic.id,
      title: topic.title,
      focus: topic.focus,
    };

    if (note?.generation === topic.generation) {
      const delivery =
        topic.directive === "send"
          ? await this.#store.deliveries.enqueueNote(note, requestId, replyTo)
          : null;

      return {
        ...record,
        revision: note.revision,
        path: note.path,
        state: "saved",
        delivery,
      };
    }

    // 重做和结束连续记录也属于当前请求，交付与收尾不能仍关联旧指令。
    await this.#store.topics.setDirective(topic.id, topic.directive, requestId);
    const taskId = await this.#store.jobs.summarize(topic, true, replyTo);

    return {
      ...record,
      taskId,
      state: taskId === null ? "empty" : "processing",
      pendingRevision: taskId === null ? null : topic.revision + 1,
    };
  }

  public async generate(job: Job<"summarize">): Promise<void> {
    const topic = await this.#store.topics.get(job.payload.topicId);

    // 已持久化的旧自动任务也只保留讨论草稿，不再调用整理模型。
    if (topic.mode === "auto") {
      await this.#store.jobs.reportProgress(
        job.id,
        "已保留为讨论草稿，无需生成纪要",
      );

      return;
    }

    while (true) {
      this.#signal.throwIfAborted();
      await this.#generate(job);
      const topic = await this.#store.topics.get(job.payload.topicId);

      if (!topic.lastSourceId || topic.generation === topic.noteGeneration) {
        return;
      }

      await this.#store.jobs.reportProgress(
        job.id,
        "原文有更新，继续整理后统一交付",
      );
    }
  }

  async #generate(job: Job<"summarize">): Promise<void> {
    const { topicId } = job.payload;
    const pendingSources = await this.#store.topics.messages(topicId);

    await this.#store.jobs.reportProgress(
      job.id,
      "正在读取原文及转发卡片中的附件",
    );
    await Promise.all(
      pendingSources.map(async (message) => {
        const assets = await this.#store.assets.forMessage(message.id);

        await Promise.all(
          assets.map((asset) =>
            waitForAsset(this.#store, message.groupId, asset.id, this.#signal),
          ),
        );
      }),
    );
    // 使用通知同步后已保存的回应；逐条远程刷新会阻塞整段历史的整理。
    // 附件解析会更新原文版本，完成后再读取本次整理的范围与版本。
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
      const images = () =>
        this.#store.assets.images(sources.map((message) => message.id));

      await writeMarkdown(
        join(directory, "transcript.md"),
        await transcript(this.#store, sources, directory),
      );
      const path = join(directory, "note.md");
      const scope = topic.focus
        ? `检索范围共 ${sources.length} 条原始消息`
        : `${sources.length} 条原始消息`;
      const header = `# ${topic.title}\n\n第 ${revision} 版 · ${scope}`;
      const footer = "[查看完整原文](transcript.md)\n";
      let excerpt = "";

      const { content, sections } = await this.#summary.generate(
        topic,
        sources,
        note,
        async (progress) => {
          const content = progress.sections
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
            `${header}\n\n> 草稿：整理尚未完成。\n\n${noteImages(content, await images(), directory)}\n\n${footer}`,
          );
          await this.#store.jobs.reportProgress(
            job.id,
            `共 ${sources.length} 条原文，已整理 ${progress.completed}/${progress.total} 批。${progress.completed === progress.total ? "正在完成纪要。" : ""}${excerpt ? `已整理内容摘录：${excerpt}。` : ""}草稿：${path}`,
          );
          this.#logger.info(
            "纪要草稿已更新：topic=%s sections=%s file=%s",
            topic.id,
            progress.sections.length,
            path,
          );
        },
      );
      const markdown = `${header}\n\n${noteImages(content, await images(), directory) || "所选原文中没有找到与整理要求相关的内容。"}\n\n${footer}`;

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
  }
}
