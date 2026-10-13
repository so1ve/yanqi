import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { Logger } from "@koishijs/core";

import type { Job, JobKind, JobPayloads, Topic } from "../types.ts";
import type { Database, JobRow } from "./schema.ts";

const logger = new Logger("yanqi:jobs");

export function decodeJob(row: JobRow) {
  const payload: JobPayloads[JobKind] = JSON.parse(row.payload);

  return { ...row, payload };
}

export async function enqueueJob<K extends JobKind>(
  db: Database,
  kind: K,
  key: string,
  payload: JobPayloads[K],
  now = Date.now(),
): Promise<number> {
  const existing = await db
    .selectFrom("jobs")
    .selectAll()
    .where("key", "=", key)
    .executeTakeFirst();

  if (!existing) {
    const job = await db
      .insertInto("jobs")
      .values({ kind, key, payload: JSON.stringify(payload), runAfter: now })
      .returning("id")
      .executeTakeFirstOrThrow();

    logger.info("任务 #%s 入队：kind=%s key=%s", job.id, kind, key);

    return job.id;
  } else if (
    kind === "summarize" &&
    "requested" in payload &&
    payload.requested &&
    existing.state !== "running"
  ) {
    await db
      .updateTable("jobs")
      .set({
        payload: JSON.stringify(payload),
        state: "pending",
        attempts: 0,
        runAfter: now,
        lastError: null,
      })
      .where("id", "=", existing.id)
      .execute();
    logger.info("任务 #%s 重新安排：kind=%s key=%s", existing.id, kind, key);
  }

  return existing.id;
}

export class JobQueue {
  #db: Database;
  #waiting = new Set<number>();

  constructor(db: Database) {
    this.#db = db;
  }

  public async recover(): Promise<void> {
    await this.cancelRequests("服务重启，跳过旧对话");
    await this.#db
      .updateTable("jobs")
      .set({ state: "pending" })
      .where("state", "=", "running")
      .execute();
  }

  public async cancelRequests(reason: string): Promise<void> {
    await this.#db
      .updateTable("jobs")
      .set({ state: "failed", lastError: reason })
      .where("kind", "in", ["intent", "observe"])
      .where("state", "in", ["pending", "running"])
      .execute();
  }

  public enqueue<K extends JobKind>(
    kind: K,
    key: string,
    payload: JobPayloads[K],
    now = Date.now(),
  ): Promise<number> {
    return this.#db
      .transaction()
      .execute((db) => enqueueJob(db, kind, key, payload, now));
  }

  public async summarize(
    topic: Topic,
    requested = false,
  ): Promise<number | null> {
    if (!topic.lastSourceId || topic.generation === topic.noteGeneration) {
      return null;
    }

    return this.enqueue(
      "summarize",
      `summarize:${topic.id}:${topic.generation}`,
      {
        groupId: topic.groupId,
        topicId: topic.id,
        requested,
      },
    );
  }

  public async hasDetection(groupId: string): Promise<boolean> {
    const row = await this.#db
      .selectFrom("jobs")
      .select("id")
      .where("kind", "=", "detect")
      .where("state", "!=", "done")
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
          "=",
          groupId,
        ),
      )
      .limit(1)
      .executeTakeFirst();

    return row !== undefined;
  }

  public claim(kind: JobKind, now: number): Promise<Job | null> {
    return this.#db.transaction().execute(async (db) => {
      const pausedGroups =
        kind === "detect" || kind === "summarize"
          ? (
              await db
                .selectFrom("groups")
                .select("id")
                .where("aiEnabled", "=", 0)
                .execute()
            ).map((group) => group.id)
          : [];
      const pausedTopics =
        kind === "summarize"
          ? (
              await db
                .selectFrom("topics")
                .select("id")
                .where("groupId", "in", pausedGroups)
                .where("mode", "=", "auto")
                .execute()
            ).map((topic) => topic.id)
          : [];
      const pending = (
        await db
          .selectFrom("jobs")
          .selectAll()
          .where("kind", "=", kind)
          .where("state", "=", "pending")
          .where("runAfter", "<=", now)
          .orderBy("id")
          .execute()
      ).map(decodeJob);

      // 等待工具所需的任务优先，其他任务仍按入队顺序处理。
      pending.sort(
        (a, b) =>
          Number(this.#waiting.has(b.id)) - Number(this.#waiting.has(a.id)),
      );
      const busyRequests =
        kind === "intent"
          ? await db
              .selectFrom("messages")
              .select(["groupId", "userId"])
              .where(
                "id",
                "in",
                db
                  .selectFrom("jobs")
                  .select((eb) =>
                    eb
                      .fn<number>("json_extract", [
                        "payload",
                        eb.val("$.messageId"),
                      ])
                      .as("messageId"),
                  )
                  .where("kind", "=", "intent")
                  .where("state", "=", "running"),
              )
              .execute()
          : [];
      const requests =
        kind === "intent"
          ? await db
              .selectFrom("messages")
              .select(["id", "groupId", "userId"])
              .where(
                "id",
                "in",
                pending.map(
                  ({ payload }) => (payload as JobPayloads["intent"]).messageId,
                ),
              )
              .execute()
          : [];
      const job = pending.find(({ payload }) => {
        if (kind === "detect") {
          return !pausedGroups.includes(payload.groupId);
        }

        if (kind === "intent" && "messageId" in payload) {
          const request = requests.find(
            (message) => message.id === payload.messageId,
          );

          assert.ok(request);

          return !busyRequests.some(
            (message) =>
              message.groupId === request.groupId &&
              message.userId === request.userId,
          );
        }

        return (
          kind !== "summarize" ||
          ("topicId" in payload &&
            (payload.requested || !pausedTopics.includes(payload.topicId)))
        );
      });

      if (!job) {
        return null;
      }

      await db
        .updateTable("jobs")
        .set({ state: "running", attempts: job.attempts + 1 })
        .where("id", "=", job.id)
        .execute();

      return { ...job, attempts: job.attempts + 1 } as Job;
    });
  }

  public async get(groupId: string, id: number) {
    const row = await this.#db
      .selectFrom("jobs")
      .selectAll()
      .where("id", "=", id)
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
          "=",
          groupId,
        ),
      )
      .executeTakeFirst();

    if (!row) {
      throw new Error(`本群没有任务 #${id}`);
    }

    return decodeJob(row);
  }

  public async forAsset(assetId: number) {
    const row = await this.#db
      .selectFrom("jobs")
      .selectAll()
      .where("kind", "=", "asset")
      .where((eb) =>
        eb(
          eb.fn<number>("json_extract", ["payload", eb.val("$.assetId")]),
          "=",
          assetId,
        ),
      )
      .executeTakeFirst();

    assert.ok(row, `附件 #${assetId} 缺少处理任务`);

    return decodeJob(row);
  }

  public async forGroup(groupId: string) {
    const rows = await this.#db
      .selectFrom("jobs")
      .selectAll()
      .where("state", "!=", "done")
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
          "=",
          groupId,
        ),
      )
      .orderBy("id", "desc")
      .limit(20)
      .execute();

    return rows.map(decodeJob);
  }

  public async restart(groupId: string, id: number): Promise<boolean> {
    const result = await this.#db
      .updateTable("jobs")
      .set({
        state: "pending",
        attempts: 0,
        runAfter: Date.now(),
        lastError: null,
        progress: null,
      })
      .where("id", "=", id)
      .where("state", "in", ["failed", "done"])
      .where("kind", "not in", ["intent", "observe"])
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
          "=",
          groupId,
        ),
      )
      .executeTakeFirst();

    return result.numUpdatedRows === 1n;
  }

  public async wait(
    groupId: string,
    id: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    const deadline = Date.now() + timeoutMs;

    this.#waiting.add(id);
    try {
      while (true) {
        signal?.throwIfAborted();
        const job = await this.get(groupId, id);

        if (job.kind === "intent" || job.kind === "observe") {
          throw new Error("不能等待对话任务，请等待附件或纪要任务");
        }

        if (
          job.state === "done" ||
          job.state === "failed" ||
          Date.now() >= deadline ||
          (job.state === "pending" && job.runAfter > deadline)
        ) {
          return job;
        }

        await delay(200, undefined, { signal });
      }
    } finally {
      this.#waiting.delete(id);
    }
  }

  public async done(id: number): Promise<void> {
    await this.#db
      .updateTable("jobs")
      .set({ state: "done", lastError: null })
      .where("id", "=", id)
      .execute();
  }

  public async reportProgress(id: number, progress: string): Promise<void> {
    await this.#db
      .updateTable("jobs")
      .set({ progress })
      .where("id", "=", id)
      .execute();
    logger.info("任务 #%s 进度：%s", id, progress);
  }

  public async interrupt(job: Job): Promise<void> {
    await this.#db
      .updateTable("jobs")
      .set({
        state:
          job.kind === "intent" || job.kind === "observe"
            ? "failed"
            : "pending",
        lastError: "管理员停止了机器人",
        runAfter: Date.now(),
      })
      .where("id", "=", job.id)
      .execute();
  }

  public forTopic(topicId: string) {
    return this.#db
      .selectFrom("jobs")
      .select(["id", "state", "progress", "lastError", "runAfter"])
      .where("kind", "=", "summarize")
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.topicId")]),
          "=",
          topicId,
        ),
      )
      .orderBy("id", "desc")
      .limit(3)
      .execute();
  }

  public async retry(
    job: Job,
    error: string,
    now: number,
    after?: number,
  ): Promise<{ state: "failed" | "pending"; runAfter: number }> {
    const state =
      job.kind === "intent" ||
      job.kind === "observe" ||
      (after === undefined && job.attempts >= 5)
        ? "failed"
        : "pending";
    const runAfter =
      after ?? now + Math.min(300_000, 5000 * 2 ** Math.min(job.attempts, 6));

    await this.#db
      .updateTable("jobs")
      .set({
        state,
        runAfter,
        attempts: after === undefined ? job.attempts : job.attempts - 1,
        lastError: error,
      })
      .where("id", "=", job.id)
      .execute();

    return { state, runAfter };
  }

  public async retryFailed(groupId: string): Promise<number> {
    const result = await this.#db
      .updateTable("jobs")
      .set({ state: "pending", attempts: 0, runAfter: Date.now() })
      .where("kind", "not in", ["intent", "observe"])
      .where("state", "=", "failed")
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
          "=",
          groupId,
        ),
      )
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }
}
