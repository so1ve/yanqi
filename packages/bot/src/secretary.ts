import type { Context, Logger } from "@koishijs/core";

import { Ai } from "./agent/ai.ts";
import type { Config } from "./config.ts";
import type { Messenger } from "./onebot/messenger.ts";
import { createMessenger } from "./onebot/messenger.ts";
import { Notes } from "./recording/notes.ts";
import type { Store } from "./storage/store.ts";
import { BackgroundTasks } from "./tasks/worker.ts";
import type { Message } from "./types.ts";
import { failureMessage } from "./utils/errors.ts";
import { logDetail } from "./utils/logging.ts";

export class Secretary {
  #config: Config;
  #store: Store;
  #messenger: Messenger;
  #tasks: BackgroundTasks;
  #logger: Logger;
  #controller = new AbortController();

  constructor(ctx: Context, config: Config, store: Store) {
    this.#config = config;
    this.#store = store;
    this.#messenger = createMessenger(config, store, ctx);
    const ai = new Ai(config, store, this.#controller.signal);
    const notes = new Notes(config, store, ai);

    this.#tasks = new BackgroundTasks(
      config,
      store,
      ai,
      notes,
      this.#messenger,
      this.#controller.signal,
    );
    this.#logger = ctx.logger("yanqi");
  }

  public async handleMessage(message: Message): Promise<void> {
    try {
      if (message.command) {
        await this.#store.jobs.enqueue("intent", `intent:${message.id}`, {
          groupId: message.groupId,
          messageId: message.id,
        });
        void this.#messenger.acknowledge(message);
      } else if (this.#config.AUTO_REPLY) {
        await this.#store.messages.observe(message);
      }

      this.processPending();
    } catch (error) {
      this.#logger.warn(
        "处理群消息失败：group=%s qqMessage=%s %s",
        message.groupId,
        message.messageId,
        logDetail(failureMessage(error), this.#config),
      );
      this.#logger.debug("群消息异常：%s", logDetail(error, this.#config));
    }
  }

  public async checkTopics(): Promise<void> {
    const now = Date.now();

    for (const groupId of this.#config.GROUP_IDS) {
      if (this.#controller.signal.aborted) {
        return;
      }

      if (
        !(await this.#store.groups.automatic(groupId)) ||
        (await this.#store.jobs.hasDetection(groupId))
      ) {
        continue;
      }

      const messages = await this.#store.messages.nextDetection(
        groupId,
        this.#config.DETECT_BATCH_SIZE,
      );

      if (
        messages.length > 0 &&
        (messages.length >= this.#config.DETECT_BATCH_SIZE ||
          messages[0]!.receivedAt + this.#config.DETECT_INTERVAL_MS <= now)
      ) {
        await this.#store.jobs.enqueue(
          "detect",
          `detect:${groupId}:${messages[0]!.id}:${messages.at(-1)!.id}`,
          { groupId, messageIds: messages.map((message) => message.id) },
          now,
        );
      }
    }

    for (const topic of await this.#store.topics.ready(
      now,
      this.#config.TOPIC_IDLE_MS,
    )) {
      await this.#store.jobs.summarize(topic);
    }
  }

  public processPending(): void {
    this.#tasks.run();
  }

  public async stop(): Promise<void> {
    this.#controller.abort();
    await this.#tasks.stop();
  }
}
