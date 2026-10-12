import { Logger } from "koishi";

import type { Ai } from "../agent/ai.ts";
import { observeConversation } from "../agent/observe.ts";
import { handleRequest } from "../agent/requests.ts";
import { AiSizeError, BudgetExceeded } from "../agent/usage.ts";
import { collectAsset } from "../assets.ts";
import type { Config } from "../config.ts";
import type { Messenger } from "../onebot/messenger.ts";
import { Outbox } from "../onebot/outbox.ts";
import { detectTopics } from "../recording/detection.ts";
import type { Notes } from "../recording/notes.ts";
import type { Store } from "../storage/store.ts";
import type { Job, JobKind } from "../types.ts";
import { AiError, failureMessage } from "../utils/errors.ts";
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

  constructor(
    config: Config,
    store: Store,
    ai: Ai,
    notes: Notes,
    messenger: Messenger,
  ) {
    this.#config = config;
    this.#store = store;
    this.#ai = ai;
    this.#notes = notes;
    this.#messenger = messenger;
    this.#outbox = new Outbox(config, store, messenger);
  }

  public run(): void {
    this.#outbox.flush();

    for (const kind of [
      "intent",
      "observe",
      "detect",
      "summarize",
      "asset",
    ] as const) {
      const concurrency = kind === "intent" ? 4 : kind === "asset" ? 2 : 1;

      while ((this.#running.get(kind) ?? 0) < concurrency) {
        this.#running.set(kind, (this.#running.get(kind) ?? 0) + 1);
        void this.#processJobs(kind)
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
          .finally(() => this.#running.set(kind, this.#running.get(kind)! - 1));
      }
    }
  }

  async #processJobs(kind: JobKind): Promise<void> {
    while (true) {
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
      switch (job.kind) {
        case "intent": {
          await handleRequest(
            job.payload.messageId,
            this.#config,
            this.#store,
            this.#ai,
            this.#notes,
            () => this.run(),
          );

          break;
        }

        case "detect": {
          await detectTopics(job, this.#config, this.#store, this.#ai);

          break;
        }

        case "observe": {
          await observeConversation(job, this.#config, this.#store, this.#ai);

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
            (progress) => this.#store.jobs.reportProgress(job.id, progress),
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
          : `重试时间=${beijingTime(retry.runAfter)}`,
      );
      this.#logger.debug(
        "任务 #%s 异常：%s",
        job.id,
        logDetail(error, this.#config),
      );
      if (job.kind === "intent") {
        await this.#store.deliveries.enqueue(
          `command:${job.payload.messageId}`,
          {
            kind: "text",
            groupId,
            content:
              error instanceof BudgetExceeded
                ? error.message
                : error instanceof AiError
                  ? `这次对话在“${error.stage}”这一步失败了。`
                  : error instanceof AiSizeError
                    ? "AI 回复超出长度限制，这次对话未完成。"
                    : "执行这次操作失败了，详细原因已记入日志。",
          },
        );
      }
    }
  }
}
