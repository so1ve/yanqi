import { Logger } from "@koishijs/core";

import type { Ai } from "../agent/ai.ts";
import { AiSizeError } from "../agent/usage.ts";
import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { ChatMessage, Message, Note, Topic } from "../types.ts";
import { contextWithin, messageChunks } from "./messages.ts";

export function reusableSections(
  sources: { id: number }[],
  previous: Note | null,
  changed: Set<number>,
): Note["sections"] {
  const sourceIds = new Set(sources.map((message) => message.id));

  return (previous?.sections ?? []).filter(
    (section) =>
      section.messageIds.length > 0 &&
      section.messageIds.every((id) => sourceIds.has(id) && !changed.has(id)),
  );
}

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
    const changed = await this.#store.topics.changedMessages(
      topic.id,
      previous?.generation ?? -1,
    );
    const sections = reusableSections(sources, previous, changed);
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

  #batches(sections: string[], budget: number): string[][] {
    const batches: string[][] = [];
    let batch: string[] = [];

    for (let remaining of sections) {
      while (remaining.length > 0) {
        let end = Math.min(remaining.length, budget - 4);

        while (JSON.stringify([remaining.slice(0, end)]).length > budget) {
          end = Math.floor(end / 2);
        }

        if (end < remaining.length) {
          const newline = remaining.lastIndexOf("\n", end - 1);

          if (newline >= end / 2) {
            end = newline + 1;
          }
        }

        const part = remaining.slice(0, end);

        if (JSON.stringify([...batch, part]).length > budget) {
          batches.push(batch);
          batch = [];
        }

        batch.push(part);
        remaining = remaining.slice(end);
      }
    }

    if (batch.length > 0) {
      batches.push(batch);
    }

    return batches;
  }

  async #reduce(
    topic: Topic,
    sections: string[],
    budget: number,
  ): Promise<string[]> {
    const reduced: string[] = [];

    for (const batch of this.#batches(sections, budget)) {
      const size = JSON.stringify(batch).length;

      if (size <= budget / 2) {
        reduced.push(...batch);

        continue;
      }

      let targetChars = Math.floor(size / 2);

      for (let attempt = 0; ; attempt++) {
        try {
          const draft = await this.#ai.recording.merge(
            topic,
            batch,
            targetChars,
          );

          if (JSON.stringify([draft]).length > size * 0.75) {
            throw new AiSizeError("中间摘要未充分缩短，无法继续整体合并");
          }

          reduced.push(draft);

          break;
        } catch (error) {
          if (!(error instanceof AiSizeError) || attempt === 1) {
            throw error;
          }

          targetChars = Math.floor(targetChars / 2);
        }
      }
    }

    if (JSON.stringify(reduced).length >= JSON.stringify(sections).length) {
      throw new AiSizeError("摘要合并输入未缩短，已停止重复合并");
    }

    return reduced;
  }

  public async compose(
    topic: Topic,
    sections: Note["sections"],
  ): Promise<string> {
    let drafts = sections
      .map((section) => section.content.trim())
      .filter(Boolean);

    if (drafts.length === 0) {
      return "";
    }

    let budget = Math.floor(this.#config.AI_INPUT_CHARS / 3);

    for (let attempt = 0; ; attempt++) {
      while (JSON.stringify(drafts).length > budget) {
        this.#logger.info(
          "纪要逐级合并：topic=%s sections=%s chars=%s",
          topic.id,
          drafts.length,
          JSON.stringify(drafts).length,
        );
        drafts = await this.#reduce(topic, drafts, budget);
      }

      try {
        // 最后一次调用统一整理全部议题；即使只有一批，也不直接交付分批草稿。
        return await this.#ai.recording.merge(topic, drafts);
      } catch (error) {
        if (!(error instanceof AiSizeError) || attempt === 1) {
          throw error;
        }

        budget = Math.floor(budget / 2);
        drafts = await this.#reduce(topic, drafts, budget);
      }
    }
  }
}
