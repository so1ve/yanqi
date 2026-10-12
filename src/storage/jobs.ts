import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { Logger } from "koishi";

import type { Job, JobKind, JobPayloads, Topic } from "../types.ts";
import type { Database } from "./schema.ts";

const logger = new Logger("yanqi:jobs");

export async function enqueueJob<K extends JobKind>(
  db: Database,
  kind: K,
  key: string,
  payload: JobPayloads[K],
  now = Date.now(),
): Promise<number> {
  const [existing] = await db.get("jobs", { key });

  if (!existing) {
    const job = await db.create("jobs", { kind, key, payload, runAfter: now });

    logger.info("任务 #%s 入队：kind=%s key=%s", job.id, kind, key);

    return job.id;
  } else if (
    kind === "summarize" &&
    "requested" in payload &&
    payload.requested &&
    existing.state !== "running"
  ) {
    await db.set(
      "jobs",
      { id: existing.id },
      {
        payload,
        state: "pending",
        attempts: 0,
        runAfter: now,
        lastError: null,
      },
    );
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

  public enqueue<K extends JobKind>(
    kind: K,
    key: string,
    payload: JobPayloads[K],
    now = Date.now(),
  ): Promise<number> {
    return this.#db.transact((db) => enqueueJob(db, kind, key, payload, now));
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
    const rows = await this.#db.get(
      "jobs",
      {
        "kind": "detect",
        "state": { $ne: "done" },
        "payload.groupId": groupId,
      },
      { limit: 1 },
    );

    return rows.length > 0;
  }

  public claim(kind: JobKind, now: number): Promise<Job | null> {
    return this.#db.transact(async (db) => {
      const pausedGroups =
        kind === "detect" || kind === "summarize"
          ? (await db.get("groups", { aiEnabled: false }, ["id"])).map(
              (group) => group.id,
            )
          : [];
      const pausedTopics =
        kind === "summarize"
          ? (
              await db.get(
                "topics",
                {
                  groupId: pausedGroups,
                  mode: "auto",
                },
                ["id"],
              )
            ).map((topic) => topic.id)
          : [];
      const pending = await db.get(
        "jobs",
        {
          kind,
          state: "pending",
          runAfter: { $lte: now },
        },
        { sort: { id: "asc" } },
      );

      // 等待工具所需的任务优先，其他任务仍按入队顺序处理。
      pending.sort(
        (a, b) =>
          Number(this.#waiting.has(b.id)) - Number(this.#waiting.has(a.id)),
      );
      const busyRequests =
        kind === "intent"
          ? await db.get("messages", {
              id: (
                await db.get("jobs", { kind: "intent", state: "running" })
              ).map(
                ({ payload }) => (payload as JobPayloads["intent"]).messageId,
              ),
            })
          : [];
      const requests =
        kind === "intent"
          ? await db.get("messages", {
              id: pending.map(
                ({ payload }) => (payload as JobPayloads["intent"]).messageId,
              ),
            })
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

      await db.set(
        "jobs",
        { id: job.id },
        { state: "running", attempts: job.attempts + 1 },
      );

      return { ...job, attempts: job.attempts + 1 } as Job;
    });
  }

  public async get(groupId: string, id: number) {
    const [job] = await this.#db.get("jobs", {
      id,
      "payload.groupId": groupId,
    });

    if (!job) {
      throw new Error(`本群没有任务 #${id}`);
    }

    return job;
  }

  public async forAsset(assetId: number) {
    const [job] = await this.#db.get("jobs", {
      "kind": "asset",
      "payload.assetId": assetId,
    });

    assert.ok(job, `附件 #${assetId} 缺少处理任务`);

    return job;
  }

  public forGroup(groupId: string) {
    return this.#db.get(
      "jobs",
      {
        "payload.groupId": groupId,
        "state": { $ne: "done" },
      },
      { sort: { id: "desc" }, limit: 20 },
    );
  }

  public async restart(groupId: string, id: number): Promise<void> {
    await this.#db.transact((db) =>
      db.set(
        "jobs",
        {
          id,
          "payload.groupId": groupId,
          "$or": [{ state: "failed" }, { state: "done" }],
          "$not": { $or: [{ kind: "intent" }, { kind: "observe" }] },
        },
        {
          state: "pending",
          attempts: 0,
          runAfter: Date.now(),
          lastError: null,
          progress: null,
        },
      ),
    );
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
    await this.#db.transact((db) =>
      db.set("jobs", { id }, { state: "done", lastError: null }),
    );
  }

  public async reportProgress(id: number, progress: string): Promise<void> {
    await this.#db.transact((db) => db.set("jobs", { id }, { progress }));
    logger.info("任务 #%s 进度：%s", id, progress);
  }

  public forTopic(topicId: string) {
    return this.#db.get(
      "jobs",
      { "kind": "summarize", "payload.topicId": topicId },
      {
        fields: ["id", "state", "progress", "lastError", "runAfter"],
        sort: { id: "desc" },
        limit: 3,
      },
    );
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

    await this.#db.transact((db) =>
      db.set(
        "jobs",
        { id: job.id },
        {
          state,
          runAfter,
          attempts: after === undefined ? job.attempts : job.attempts - 1,
          lastError: error,
        },
      ),
    );

    return { state, runAfter };
  }

  public async retryFailed(groupId: string): Promise<number> {
    const result = await this.#db.transact((db) =>
      db.set(
        "jobs",
        {
          "$not": { $or: [{ kind: "intent" }, { kind: "observe" }] },
          "state": "failed",
          "payload.groupId": groupId,
        },
        {
          state: "pending",
          attempts: 0,
          runAfter: Date.now(),
        },
      ),
    );

    return result.matched!;
  }
}
