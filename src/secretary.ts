import assert from "node:assert/strict";

import type { Context, Logger, Session } from "koishi";

import { Ai } from "./agent/models.ts";
import { MAX_REPLY_CHARS } from "./agent/prompts.ts";
import { handleRequest } from "./agent/requests.ts";
import { BudgetExceeded } from "./agent/usage.ts";
import { collectAsset } from "./assets.ts";
import type { Config } from "./config.ts";
import type { Messenger } from "./onebot/messenger.ts";
import { createMessenger } from "./onebot/messenger.ts";
import { detectTopics } from "./recording/detection.ts";
import { Notes } from "./recording/notes.ts";
import type { Store } from "./storage/store.ts";
import type { Job, JobKind } from "./types.ts";
import { failureMessage } from "./utils/errors.ts";
import { logContext, logDetail } from "./utils/logging.ts";

export class Secretary {
  #config: Config;
  #store: Store;
  #messenger: Messenger;
  #ai: Ai;
  #notes: Notes;
  #logger: Logger;
  #running = new Set<JobKind | "send">();

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
    await this.#store.recall(
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

  public processPending(): void {
    for (const kind of [
      "intent",
      "detect",
      "summarize",
      "asset",
      "send",
    ] as const) {
      if (this.#running.has(kind)) {
        continue;
      }

      this.#running.add(kind);
      const work =
        kind === "send" ? this.#sendPending() : this.#processJobs(kind);

      void work
        .catch((error) => {
          this.#logger.warn(
            "%s 队列处理失败：%s",
            kind,
            logDetail(failureMessage(error), this.#config),
          );
          this.#logger.debug(
            "%s 队列异常：%s",
            kind,
            logDetail(error, this.#config),
          );
        })
        .finally(() => this.#running.delete(kind));
    }
  }

  async #processJobs(kind: JobKind): Promise<void> {
    while (true) {
      const job = await this.#store.jobs.claim(kind, Date.now());

      if (!job) {
        return;
      }

      await logContext.run(`任务 #${job.id}`, () => this.#executeTask(job));
      this.processPending();
    }
  }

  async #executeTask(job: Job): Promise<void> {
    const groupId = job.payload.groupId;

    if (!this.#config.GROUP_IDS.includes(groupId)) {
      await this.#store.jobs.done(job.id);
      this.#logger.info("任务 #%s 跳过：群 %s 已不在配置中", job.id, groupId);

      return;
    }

    const startedAt = performance.now();

    this.#logger.info(
      "任务 #%s 开始：kind=%s attempt=%s payload=%s",
      job.id,
      job.kind,
      job.attempts,
      JSON.stringify(job.payload),
    );

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
          await this.#notes.generate(
            job.payload.topicId,
            job.payload.requested,
          );

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
      this.#logger.info(
        "任务 #%s 完成：耗时=%s ms",
        job.id,
        Math.round(performance.now() - startedAt),
      );
    } catch (error) {
      const message = logDetail(failureMessage(error), this.#config);
      const retry = await this.#store.jobs.retry(
        job,
        message,
        Date.now(),
        error instanceof BudgetExceeded ? error.nextRunAt : undefined,
      );

      this.#logger.warn(
        "任务 #%s 失败：kind=%s group=%s attempt=%s 耗时=%s ms %s；%s",
        job.id,
        job.kind,
        groupId,
        job.attempts,
        Math.round(performance.now() - startedAt),
        message,
        retry.state === "failed"
          ? "已标记失败"
          : `重试时间=${new Date(retry.runAfter).toISOString()}`,
      );
      this.#logger.debug(
        "任务 #%s 异常：%s",
        job.id,
        logDetail(error, this.#config),
      );
      if (job.kind === "intent") {
        await this.#store.deliveries.enqueue(
          `intent-error:${job.payload.messageId}`,
          {
            kind: "text",
            groupId,
            content:
              "这次对话没能完成。已保存的记录仍在，可以查询状态，或直接告诉我接下来要做什么。",
          },
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
        this.#logger.info(
          "发送 #%s 跳过：群 %s 已不在配置中",
          delivery.id,
          delivery.groupId,
        );

        continue;
      }

      if (delivery.kind === "note" && delivery.topicId) {
        const topic = await this.#store.topic(delivery.topicId);

        if (topic.directive === "hold") {
          await this.#store.deliveries.done(delivery.id);
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
          const note = await this.#store.note(delivery.noteId);

          await this.#messenger.sendNote(note);
        } else {
          let text = delivery.content;

          try {
            text = await logContext.run(`发送 #${delivery.id}`, () =>
              this.#ai.voice(delivery.content),
            );
          } catch (error) {
            if (text.length > MAX_REPLY_CHARS) {
              throw error;
            }

            this.#logger.warn(
              "发送 #%s 回复改写失败，使用原答复：%s",
              delivery.id,
              logDetail(failureMessage(error), this.#config),
            );
            this.#logger.debug(
              "发送 #%s 改写异常：%s",
              delivery.id,
              logDetail(error, this.#config),
            );
          }

          this.#logger.debug(
            "发送 #%s 文字：%s",
            delivery.id,
            logDetail(text, this.#config),
          );
          await this.#messenger.sendText(delivery.groupId, text);
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
}
