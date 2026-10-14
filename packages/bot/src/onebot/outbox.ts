import assert from "node:assert/strict";

import { Logger } from "@koishijs/core";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { Delivery, Note } from "../types.ts";
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

      const batch: Delivery[] = [];
      const notes: Note[] = [];

      if (delivery.kind === "note") {
        for (const item of await this.#store.deliveries.pendingNotes(
          delivery.groupId,
          delivery.replyTo,
        )) {
          assert.ok(item.noteId !== null && item.topicId !== null);
          const topic = await this.#store.topics.get(item.topicId);

          if (topic.directive === "hold") {
            await this.#store.deliveries.cancel(item.id);

            continue;
          }

          batch.push(item);
          if (!notes.some((note) => note.id === item.noteId)) {
            notes.push(await this.#store.notes.get(item.noteId));
          }
        }

        if (batch.length === 0) {
          continue;
        }
      } else {
        batch.push(delivery);
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
          await this.#messenger.sendNotes(
            notes,
            [
              ...new Set(batch.map((item) => item.content).filter(Boolean)),
            ].join("\n"),
            delivery.replyTo,
          );
        } else {
          this.#logger.debug(
            "发送 #%s 文字：%s",
            delivery.id,
            logDetail(delivery.content, this.#config),
          );
          if (!(await this.#store.deliveries.isPending(delivery.id))) {
            continue;
          }

          await this.#messenger.sendText(
            delivery.groupId,
            delivery.content,
            delivery.replyTo,
          );
        }

        for (const item of batch) {
          await this.#store.deliveries.done(item.id);
        }

        this.#logger.info(
          "发送 #%s 完成：耗时=%s ms",
          delivery.id,
          Math.round(performance.now() - startedAt),
        );
      } catch (error) {
        for (const item of batch) {
          await this.#store.deliveries.fail(item.id);
        }

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
