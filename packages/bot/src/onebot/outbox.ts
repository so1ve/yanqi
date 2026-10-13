import assert from "node:assert/strict";

import { Logger } from "@koishijs/core";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { Delivery } from "../types.ts";
import { failureMessage } from "../utils/errors.ts";
import { logDetail } from "../utils/logging.ts";
import type { Messenger } from "./messenger.ts";

export class Outbox {
  #config: Config;
  #store: Store;
  #messenger: Messenger;
  #logger = new Logger("yanqi:delivery");
  #running = new Map<Delivery["kind"], Promise<void>>();
  #stopped = false;

  constructor(config: Config, store: Store, messenger: Messenger) {
    this.#config = config;
    this.#store = store;
    this.#messenger = messenger;
  }

  public flush(): void {
    if (this.#stopped) {
      return;
    }

    for (const kind of ["text", "note"] as const) {
      if (this.#running.has(kind)) {
        continue;
      }

      const pending = this.#send(kind)
        .catch((error) =>
          this.#logger.warn("发送队列失败：%s", logDetail(error, this.#config)),
        )
        .finally(() => {
          this.#running.delete(kind);
        });

      this.#running.set(kind, pending);
    }
  }

  async #send(kind: Delivery["kind"]): Promise<void> {
    while (!this.#stopped && this.#messenger.online) {
      const delivery = await this.#store.deliveries.next(kind);

      if (!delivery) {
        return;
      }

      if (this.#stopped) {
        return;
      }

      if (!this.#config.GROUP_IDS.includes(delivery.groupId)) {
        await this.#store.deliveries.cancel(delivery.id);
        this.#logger.info(
          "发送 #%s 跳过：群 %s 已不在配置中",
          delivery.id,
          delivery.groupId,
        );

        continue;
      }

      if (delivery.kind === "note" && delivery.topicId) {
        const topic = await this.#store.topics.get(delivery.topicId);

        if (topic.directive === "hold") {
          await this.#store.deliveries.cancel(delivery.id);
          this.#logger.info(
            "发送 #%s 取消：topic=%s 已要求暂缓",
            delivery.id,
            topic.id,
          );

          continue;
        }
      }

      const startedAt = performance.now();

      this.#logger.info(
        "发送 #%s 开始：group=%s kind=%s topic=%s note=%s",
        delivery.id,
        delivery.groupId,
        delivery.kind,
        delivery.topicId,
        delivery.noteId,
      );

      try {
        if (delivery.kind === "note") {
          assert.ok(delivery.noteId !== null);
          const note = await this.#store.notes.get(delivery.noteId);

          await this.#messenger.sendNote(note);
        } else {
          this.#logger.debug(
            "发送 #%s 文字：%s",
            delivery.id,
            logDetail(delivery.content, this.#config),
          );
          if (!(await this.#store.deliveries.isPending(delivery.id))) {
            continue;
          }

          await this.#messenger.sendText(delivery.groupId, delivery.content);
        }

        await this.#store.deliveries.done(delivery.id);
        this.#logger.info(
          "发送 #%s 完成：耗时=%s ms",
          delivery.id,
          Math.round(performance.now() - startedAt),
        );
      } catch (error) {
        await this.#store.deliveries.fail(delivery.id);
        this.#logger.warn(
          "发送 #%s 失败：group=%s 耗时=%s ms %s",
          delivery.id,
          delivery.groupId,
          Math.round(performance.now() - startedAt),
          logDetail(failureMessage(error), this.#config),
        );
        this.#logger.debug(
          "发送 #%s 异常：%s",
          delivery.id,
          logDetail(error, this.#config),
        );
      }
    }
  }

  public async stop(): Promise<void> {
    this.#stopped = true;
    await Promise.all(this.#running.values());
  }
}
