import assert from "node:assert/strict";

import type { Context, Logger, Session } from "koishi";

import { Ai } from "./agent/models.ts";
import { handleRequest } from "./agent/requests.ts";
import { BudgetExceeded } from "./agent/usage.ts";
import { collectAsset } from "./assets.ts";
import type { Config } from "./config.ts";
import type { Messenger } from "./onebot/messenger.ts";
import { createMessenger } from "./onebot/messenger.ts";
import { detectTopics } from "./recording/detection.ts";
import { Notes } from "./recording/notes.ts";
import type { Store } from "./storage/store.ts";
import type { Job } from "./types.ts";
import { failureMessage } from "./utils/errors.ts";

export class Secretary {
  #config: Config;
  #store: Store;
  #messenger: Messenger;
  #ai: Ai;
  #notes: Notes;
  #logger: Logger;
  #processing = false;

  constructor(ctx: Context, config: Config, store: Store) {
    this.#config = config;
    this.#store = store;
    this.#messenger = createMessenger(config, this.#store, ctx);
    this.#ai = new Ai(config, this.#store);
    this.#notes = new Notes(config, this.#store, this.#ai);
    this.#logger = ctx.logger("yanqi");
  }

  public async handleMessage(session: Session): Promise<void> {
    try {
      const raw = session.onebot!;

      assert.ok(Array.isArray(raw.message), "请将 NapCat 消息格式设为 array");
      const role = session.event.member?.roles;
      const message = await this.#store.capture({
        groupId: session.guildId!,
        messageId: session.messageId!,
        userId: session.userId!,
        displayName: session.event.member?.nick || session.event.user!.name!,
        sentAt: session.timestamp,
        receivedAt: Date.now(),
        text: session
          .elements!.filter((element) => element.type === "text")
          .map((element) => element.attrs.content)
          .join(""),
        segments: raw.message,
        raw: session.event._data,
        replyTo:
          raw.message.find((segment) => segment.type === "reply")?.data.id ??
          null,
        isBot: session.userId === session.selfId,
        addressed: session.elements!.some(
          (element) =>
            element.type === "at" && element.attrs.id === session.selfId,
        ),
        role: role?.some((item) => item.id === "owner")
          ? "owner"
          : role?.some((item) => item.id === "admin")
            ? "admin"
            : "member",
      });

      if (message) {
        await this.processPending();
      }
    } catch (error) {
      this.#logger.warn(failureMessage(error));
    }
  }

  public async handleRecall(session: Session): Promise<void> {
    await this.#store.recall(
      session.guildId!,
      session.messageId!,
      session.onebot!.time * 1000,
    );
  }

  public async checkTopics(): Promise<void> {
    const now = Date.now();

    for (const groupId of this.#config.GROUP_IDS) {
      if (
        !(await this.#store.aiEnabled(groupId)) ||
        (await this.#store.jobs.hasDetection(groupId))
      ) {
        continue;
      }

      const messages = await this.#store.nextDetection(
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

    for (const topic of await this.#store.readyTopics(
      now,
      this.#config.TOPIC_IDLE_MS,
    )) {
      await this.#notes.schedule(topic);
    }
  }

  public async processPending(): Promise<void> {
    if (this.#processing) {
      return;
    }

    this.#processing = true;
    try {
      while (true) {
        await this.#sendPending();
        const job = await this.#store.jobs.claim(Date.now());

        if (!job) {
          return;
        }

        await this.#executeTask(job);
      }
    } finally {
      this.#processing = false;
    }
  }

  async #executeTask(job: Job): Promise<void> {
    const groupId = job.payload.groupId;

    if (!this.#config.GROUP_IDS.includes(groupId)) {
      await this.#store.jobs.done(job.id);

      return;
    }

    if (
      (job.kind === "detect" ||
        (job.kind === "summarize" &&
          !job.payload.requested &&
          (await this.#store.topic(job.payload.topicId)).mode === "auto")) &&
      !(await this.#store.aiEnabled(groupId))
    ) {
      await this.#store.jobs.retry(
        job,
        "本群自动整理已暂停",
        Date.now(),
        Date.now() + 60_000,
      );

      return;
    }

    try {
      switch (job.kind) {
        case "intent": {
          await handleRequest(
            job.payload.messageId,
            this.#config,
            this.#store,
            this.#ai,
            this.#notes,
          );

          break;
        }

        case "detect": {
          await detectTopics(job, this.#config, this.#store, this.#ai);

          break;
        }

        case "summarize": {
          await this.#notes.generate(job);

          break;
        }

        case "asset": {
          await collectAsset(
            job.payload.assetId,
            this.#store,
            this.#config,
            this.#ai,
            this.#messenger,
          );

          break;
        }
      }

      await this.#store.jobs.done(job.id);
    } catch (error) {
      const message = failureMessage(error);

      await this.#store.jobs.retry(
        job,
        message,
        Date.now(),
        error instanceof BudgetExceeded ? error.nextRunAt : undefined,
      );
      this.#logger.warn(`任务 ${job.id}（${job.kind}）：${message}`);
      if (job.kind === "intent") {
        await this.#store.deliveries.enqueue(
          `intent-error:${job.payload.messageId}`,
          groupId,
          null,
          null,
          "text",
          "原文已保存，但这次请求没有处理完。可以问我记录和任务状态。",
        );
      }
    }
  }

  async #sendPending(): Promise<void> {
    while (this.#messenger.online) {
      const delivery = await this.#store.deliveries.next();

      if (!delivery) {
        return;
      }

      if (!this.#config.GROUP_IDS.includes(delivery.groupId)) {
        await this.#store.deliveries.done(delivery.id);

        continue;
      }

      if (delivery.kind === "note" && delivery.topicId) {
        const topic = await this.#store.topic(delivery.topicId);

        if (
          topic.directive === "hold" ||
          (delivery.noteId !== null &&
            (await this.#store.note(delivery.noteId)).generation !==
              topic.generation)
        ) {
          await this.#store.deliveries.done(delivery.id);

          continue;
        }
      }

      try {
        if (delivery.kind === "note") {
          const title = delivery.topicId
            ? (await this.#store.topic(delivery.topicId)).title
            : "言栖纪要";

          await this.#messenger.sendNote(
            delivery.groupId,
            title,
            delivery.content,
          );
        } else {
          let text = delivery.content;

          try {
            text = await this.#ai.voice(text);
          } catch (error) {
            this.#logger.warn(
              `回复改写失败，使用原答复：${failureMessage(error)}`,
            );
          }

          await this.#messenger.sendText(delivery.groupId, text);
        }
      } catch (error) {
        this.#logger.warn(
          `发送到群 ${delivery.groupId} 失败：${failureMessage(error)}`,
        );
      } finally {
        await this.#store.deliveries.done(delivery.id);
      }
    }
  }
}
