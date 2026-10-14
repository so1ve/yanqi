import { Logger } from "@koishijs/core";

import type { Ai } from "../agent/ai.ts";
import { observeRequests } from "../agent/observe.ts";
import { handleRequest } from "../agent/requests.ts";
import { AiSizeError, BudgetExceeded } from "../agent/usage.ts";
import { collectAsset } from "../assets.ts";
import type { Config } from "../config.ts";
import type { Messenger } from "../onebot/messenger.ts";
import { Outbox } from "../onebot/outbox.ts";
import type { ReactionSync } from "../onebot/reactions.ts";
import { detectTopics } from "../recording/detection.ts";
import type { Notes } from "../recording/notes.ts";
import { publishNotes } from "../recording/publication.ts";
import type { Store } from "../storage/store.ts";
import type { Job, JobKind } from "../types.ts";
import { AiError, AiProtocolError, failureMessage } from "../utils/errors.ts";
import { logContext, logDetail } from "../utils/logging.ts";
import { beijingTime } from "../utils/time.ts";

export class BackgroundTasks {
  #config: Config;
  #store: Store;
  #ai: Ai;
  #notes: Notes;
  #messenger: Messenger;
  #outbox: Outbox;
  #logger = new Logger("yanqi:tasks");
  #running = new Map<JobKind, number>();
  #pending = new Set<Promise<void>>();
  #signal: AbortSignal;
  #reactions: ReactionSync;

  constructor(
    config: Config,
    store: Store,
    ai: Ai,
    notes: Notes,
    messenger: Messenger,
    signal: AbortSignal,
    reactions: ReactionSync,
  ) {
    this.#config = config;
    this.#store = store;
    this.#ai = ai;
    this.#notes = notes;
    this.#messenger = messenger;
    this.#outbox = new Outbox(config, store, messenger);
    this.#signal = signal;
    this.#reactions = reactions;
  }

  public run(): void {
    if (this.#signal.aborted) {
      return;
    }

    this.#outbox.flush();

    for (const kind of [
      "intent",
      "observe",
      "memory",
      "detect",
      "summarize",
      "publish",
      "asset",
    ] as const) {
      const concurrency = kind === "intent" ? 4 : kind === "asset" ? 2 : 1;

      while ((this.#running.get(kind) ?? 0) < concurrency) {
        this.#running.set(kind, (this.#running.get(kind) ?? 0) + 1);
        const pending = this.#processJobs(kind)
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
          .finally(() => {
            this.#running.set(kind, this.#running.get(kind)! - 1);
            this.#pending.delete(pending);
          });

        this.#pending.add(pending);
      }
    }
  }

  async #processJobs(kind: JobKind): Promise<void> {
    while (!this.#signal.aborted) {
      const job = await this.#store.jobs.claim(kind, Date.now());

      if (!job) {
        return;
      }

      await logContext.run(
        {
          task: `任务 #${job.id}`,
          groupId: job.payload.groupId,
          ...(job.kind === "intent"
            ? { requestId: job.payload.messageId }
            : {}),
        },
        () => this.#executeTask(job),
      );
      this.run();
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
      this.#signal.throwIfAborted();
      switch (job.kind) {
        case "intent": {
          await handleRequest(
            job.payload.messageId,
            this.#config,
            this.#store,
            this.#ai,
            this.#notes,
            () => this.run(),
            this.#reactions,
          );

          break;
        }

        case "detect": {
          await detectTopics(job, this.#config, this.#store, this.#ai);

          break;
        }

        case "observe": {
          await observeRequests(job, this.#config, this.#store, this.#ai);

          break;
        }

        case "memory": {
          await this.#ai.memory.review(job.payload.messageId);

          break;
        }

        case "summarize": {
          await this.#notes.generate(job);

          break;
        }

        case "publish": {
          await publishNotes(this.#config, this.#store, this.#ai, job);

          break;
        }

        case "asset": {
          await collectAsset(
            job.payload.assetId,
            this.#store,
            this.#config,
            this.#ai,
            this.#messenger,
            (progress) => this.#store.jobs.reportProgress(job.id, progress),
            this.#signal,
            job.payload.refresh,
          );

          const asset = await this.#store.assets.get(job.payload.assetId);

          if (
            !job.payload.refresh &&
            this.#config.AUTO_REPLY &&
            asset.interpretation
          ) {
            const message = await this.#store.inbox.getRequest(asset.messageId);

            if (message) {
              await this.#store.inbox.observe(message, true);
            }
          }

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
      if (this.#signal.aborted) {
        await this.#store.jobs.interrupt(job);

        return;
      }

      const message = logDetail(failureMessage(error), this.#config);
      const retry = await this.#store.jobs.retry(job, message, Date.now(), {
        ...(error instanceof BudgetExceeded ? { after: error.nextRunAt } : {}),
        retryable:
          !(error instanceof AiProtocolError) &&
          !(error instanceof AiSizeError),
      });

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
          : `重试时间=${beijingTime(retry.runAfter)}`,
      );
      this.#logger.debug(
        "任务 #%s 异常：%s",
        job.id,
        logDetail(error, this.#config),
      );
      if (job.kind === "intent") {
        const deliveries = await this.#store.deliveries.forRequest(
          job.payload.messageId,
        );

        if (
          (await this.#store.jobs.publishesRequest(
            groupId,
            job.payload.messageId,
          )) ||
          deliveries.some(
            ({ state }) => state === "pending" || state === "done",
          )
        ) {
          return;
        }

        await this.#store.deliveries.enqueue(
          `command:${job.payload.messageId}`,
          {
            kind: "text",
            groupId,
            content:
              error instanceof BudgetExceeded
                ? error.message
                : error instanceof AiError
                  ? `${error.stage}时出错，本次对话已中断。`
                  : error instanceof AiSizeError
                    ? "AI 输出达到长度限制，本次对话已中断。"
                    : "本次对话已中断，具体原因请查看运行日志。",
          },
        );
      }
    }
  }

  public async stop(): Promise<void> {
    await Promise.all([this.#outbox.stop(), ...this.#pending]);
  }
}
