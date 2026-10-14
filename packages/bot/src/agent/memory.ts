import type { Config } from "../config.ts";
import { contextWithin, messageChunks } from "../recording/messages.ts";
import type { Store } from "../storage/store.ts";
import { beijingTime } from "../utils/time.ts";
import { chatSourceRules } from "./prompts/common.ts";
import { memoryReviewPrompt } from "./prompts/memory.ts";
import type { AgentRuntime } from "./runtime.ts";
import { memoryTool } from "./tools/memory.ts";

export class MemoryAI {
  #config: Config;
  #store: Store;
  #runtime: AgentRuntime;

  constructor(config: Config, store: Store, runtime: AgentRuntime) {
    this.#config = config;
    this.#store = store;
    this.#runtime = runtime;
  }

  public async review(messageId: number): Promise<void> {
    const message = await this.#store.inbox.getRequest(messageId);

    if (!message) {
      return;
    }

    const conversation = await this.#store.conversations.open(message.groupId);

    if (message.id <= conversation.afterMessageId) {
      return;
    }

    const budget = this.#config.AI_INPUT_CHARS;
    const context = await contextWithin(
      this.#store,
      (
        await this.#store.messages.conversation(
          message.groupId,
          20,
          message.id - 1,
          conversation.afterMessageId,
        )
      ).filter((item) => item.recalledAt === null),
      Math.floor(budget / 3),
    );
    const quoted = message.replyTo
      ? await this.#store.messages.quoted(message.groupId, message.replyTo)
      : null;
    const quotedContent =
      quoted?.recalledAt === null
        ? await contextWithin(this.#store, [quoted], Math.floor(budget / 6))
        : [];
    const chunks = await messageChunks(
      this.#store,
      [message],
      Math.floor(budget / 2),
    );

    for (const source of chunks) {
      await this.#runtime.text(
        "memory",
        `${memoryReviewPrompt}\n${chatSourceRules(this.#config.BOT_QQ)}`,
        {
          source,
          context,
          quoted: quotedContent,
          memory: await this.#store.memories.index(
            message.groupId,
            message.userId,
          ),
          sourceUserId: message.userId,
          now: beijingTime(Date.now()),
        },
        {
          thinking: "low",
          maxTurns: 6,
          tools: [memoryTool({ store: this.#store, message })],
        },
      );
    }
  }
}
