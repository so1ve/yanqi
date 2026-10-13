import { Logger } from "@koishijs/core";

import type { Ai } from "../agent/ai.ts";
import { AiSizeError } from "../agent/usage.ts";
import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { ChatMessage, Message, Note, Topic } from "../types.ts";
import { contextWithin, messageChunks } from "./messages.ts";

export class Summarizer {
  #config: Config;
  #store: Store;
  #ai: Ai;
  #logger = new Logger("yanqi:notes");

  constructor(config: Config, store: Store, ai: Ai) {
    this.#config = config;
    this.#store = store;
    this.#ai = ai;
  }

  async #summarize(
    topic: Topic,
    chunk: ChatMessage[],
    context: ChatMessage[],
  ): Promise<string> {
    try {
      return await this.#ai.recording.summarize(topic, chunk, context);
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

  public async *sections(
    topic: Topic,
    sources: Message[],
    previous: Note | null,
  ): AsyncGenerator<{
    sections: Note["sections"];
    completed: number;
    total: number;
  }> {
    const sourceIds = new Set(sources.map((message) => message.id));
    const changed = await this.#store.topics.changedMessages(
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
          [...quotes].map((id) =>
            this.#store.messages.get(Number(id.slice(1))),
          ),
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

  async #merge(topic: Topic, sections: string[]): Promise<string> {
    if (sections.length === 1) {
      return sections[0]!;
    }

    try {
      return await this.#ai.recording.merge(topic, sections);
    } catch (error) {
      if (!(error instanceof AiSizeError)) {
        throw error;
      }

      this.#logger.warn(
        "合并超出模型限制，拆小批次继续：sections=%s",
        sections.length,
      );
      const middle = Math.ceil(sections.length / 2);
      const first = await this.#merge(topic, sections.slice(0, middle));
      const second = await this.#merge(topic, sections.slice(middle));

      return `${first}\n\n${second}`;
    }
  }

  public async compose(
    topic: Topic,
    sections: Note["sections"],
  ): Promise<string> {
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

      chapters.push(await this.#merge(topic, batch));
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
}
