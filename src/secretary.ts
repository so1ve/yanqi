import type { Context, Logger, Session } from "koishi";

import { Ai } from "./agent/ai.ts";
import type { Config } from "./config.ts";
import { incomingMessage } from "./onebot/message.ts";
import type { Messenger } from "./onebot/messenger.ts";
import { createMessenger } from "./onebot/messenger.ts";
import { Notes } from "./recording/notes.ts";
import type { Store } from "./storage/store.ts";
import { BackgroundTasks } from "./tasks/worker.ts";
import { failureMessage } from "./utils/errors.ts";
import { logDetail } from "./utils/logging.ts";

export class Secretary {
  #config: Config;
  #store: Store;
  #messenger: Messenger;
  #tasks: BackgroundTasks;
  #logger: Logger;

  constructor(ctx: Context, config: Config, store: Store) {
    this.#config = config;
    this.#store = store;
    this.#messenger = createMessenger(config, store, ctx);
    const ai = new Ai(config, store);
    const notes = new Notes(config, store, ai);

    this.#tasks = new BackgroundTasks(
      config,
      store,
      ai,
      notes,
      this.#messenger,
    );
    this.#logger = ctx.logger("yanqi");
  }

  public async handleMessage(session: Session): Promise<void> {
    try {
      const message = await this.#store.messages.capture(
        incomingMessage(session),
      );

      if (message) {
        if (message.command) {
          void this.#messenger
            .acknowledge(message.groupId, message.messageId)
            .catch((error) =>
              this.#logger.warn(
                "收到请求的表情回应失败：m%s %s",
                message.id,
                logDetail(failureMessage(error), this.#config),
              ),
            );
        } else if (this.#config.AUTO_REPLY) {
          await this.#store.messages.observe(message);
        }

        this.#logger[message.command ? "info" : "debug"](
          "消息 m%s 已保存：group=%s qqMessage=%s user=%s addressed=%s bot=%s chars=%s",
          message.id,
          message.groupId,
          message.messageId,
          message.userId,
          message.addressed,
          message.isBot,
          message.text.length,
        );
        this.processPending();
      } else {
        this.#logger.debug(
          "忽略重复消息：group=%s qqMessage=%s",
          session.guildId,
          session.messageId,
        );
      }
    } catch (error) {
      this.#logger.warn(
        "处理群消息失败：group=%s qqMessage=%s %s",
        session.guildId,
        session.messageId,
        logDetail(failureMessage(error), this.#config),
      );
      this.#logger.debug("群消息异常：%s", logDetail(error, this.#config));
    }
  }

  public async handleRecall(session: Session): Promise<void> {
    await this.#store.messages.recall(
      session.guildId!,
      session.messageId!,
      session.onebot!.time * 1000,
    );
    this.#logger.info(
      "消息撤回：group=%s qqMessage=%s",
      session.guildId,
      session.messageId,
    );
  }

  public async checkTopics(): Promise<void> {
    const now = Date.now();

    for (const groupId of this.#config.GROUP_IDS) {
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
}
