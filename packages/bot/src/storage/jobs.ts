import assert from "node:assert/strict";
import { EventEmitter, on } from "node:events";

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
  #changes = new EventEmitter();

  constructor(db: Database) {
    this.#db = db;
  }

  public async page(
    groupId: string,
    options: { offset: number; limit: number; state?: JobRow["state"] },
  ) {
    let query = this.#db
      .selectFrom("jobs")
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
          "=",
          groupId,
        ),
      );

    if (options.state) {
      query = query.where("state", "=", options.state);
    }

    const [items, total] = await Promise.all([
      query
        .selectAll()
        .orderBy("id", "desc")
        .offset(options.offset)
        .limit(options.limit)
        .execute(),
      query
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
    ]);

    return { items: items.map(decodeJob), total: total.count };
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
          Number(this.#changes.listenerCount(String(b.id)) > 0) -
          Number(this.#changes.listenerCount(String(a.id)) > 0),
      );
      const busyGroups =
        kind === "intent"
          ? await db
              .selectFrom("jobs")
              .select((eb) =>
                eb
                  .fn<string>("json_extract", ["payload", eb.val("$.groupId")])
                  .as("groupId"),
              )
              .where("kind", "=", "intent")
              .where("state", "=", "running")
              .execute()
          : [];
      const job = pending.find(({ payload }) => {
        if (kind === "detect") {
          return !pausedGroups.includes(payload.groupId);
        }

        if (kind === "intent") {
          return !busyGroups.some((group) => group.groupId === payload.groupId);
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
      .where("kind", "not in", ["intent", "observe"])
      .where((eb) =>
        eb.or([eb("state", "!=", "done"), eb("kind", "=", "summarize")]),
      )
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

  public async wait(groupId: string, id: number, signal?: AbortSignal) {
    // 先订阅再读取，避免任务恰好在读取期间完成而漏掉通知。
    const changes = on(this.#changes, String(id), { signal });

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
          (job.state === "pending" && job.lastError !== null)
        ) {
          return job;
        }

        await changes.next();
      }
    } finally {
      await changes.return!();
    }
  }

  public async done(id: number): Promise<void> {
    await this.#db
      .updateTable("jobs")
      .set({ state: "done", lastError: null })
      .where("id", "=", id)
      .execute();
    this.#changes.emit(String(id));
  }

  public async cancel(groupId: string, id: number) {
    const result = await this.#db.transaction().execute(async (db) => {
      const row = await db
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
        return "missing" as const;
      }

      if (row.state === "running") {
        return "running" as const;
      }

      const job = decodeJob(row);

      if (job.kind === "detect" && "messageIds" in job.payload) {
        const through = Math.max(0, ...job.payload.messageIds);

        await db
          .updateTable("groups")
          .set((eb) => ({
            cursor: eb.fn<number>("max", ["cursor", eb.val(through)]),
          }))
          .where("id", "=", groupId)
          .execute();
      }

      await db
        .updateTable("jobs")
        .set({ state: "done", lastError: "管理员取消", progress: "已取消" })
        .where("id", "=", id)
        .execute();

      return "cancelled" as const;
    });

    if (result === "cancelled") {
      this.#changes.emit(String(id));
    }

    return result;
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
    this.#changes.emit(String(job.id));
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
    this.#changes.emit(String(job.id));

    return { state, runAfter };
  }

  public async retryFailed(groupId: string): Promise<number> {
    const result = await this.#db
      .updateTable("jobs")
      .set({
        state: "pending",
        attempts: 0,
        runAfter: Date.now(),
        lastError: null,
      })
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
