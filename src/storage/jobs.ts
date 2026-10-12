import { Logger } from "koishi";

import type { Job, JobKind, JobPayloads } from "../types.ts";
import type { Database } from "./schema.ts";

const logger = new Logger("yanqi:jobs");

export async function enqueueJob<K extends JobKind>(
  db: Database,
  kind: K,
  key: string,
  payload: JobPayloads[K],
  now = Date.now(),
): Promise<void> {
  const [existing] = await db.get("jobs", { key });

  if (!existing) {
    const job = await db.create("jobs", { kind, key, payload, runAfter: now });

    logger.info("任务 #%s 入队：kind=%s key=%s", job.id, kind, key);
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
}

export class JobQueue {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public enqueue<K extends JobKind>(
    kind: K,
    key: string,
    payload: JobPayloads[K],
    now = Date.now(),
  ): Promise<void> {
    return this.#db.transact((db) => enqueueJob(db, kind, key, payload, now));
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
      const pausedGroups = (
        await db.get("groups", { aiEnabled: false }, ["id"])
      ).map((group) => group.id);
      const pausedTopics = (
        await db.get(
          "topics",
          {
            groupId: pausedGroups,
            mode: "auto",
          },
          ["id"],
        )
      ).map((topic) => topic.id);
      const [job] = await db.get(
        "jobs",
        {
          kind,
          state: "pending",
          runAfter: { $lte: now },
          $or: [
            { kind: ["intent", "asset"] },
            { "payload.groupId": { $nin: pausedGroups } },
            { "kind": "summarize", "payload.requested": true },
            { "kind": "summarize", "payload.topicId": { $nin: pausedTopics } },
          ],
        },
        { sort: { id: "asc" }, limit: 1 },
      );

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

  public async done(id: number): Promise<void> {
    await this.#db.transact((db) =>
      db.set("jobs", { id }, { state: "done", lastError: null }),
    );
  }

  public async retry(
    job: Job,
    error: string,
    now: number,
    after?: number,
  ): Promise<{ state: "failed" | "pending"; runAfter: number }> {
    const state =
      job.kind === "intent" || (after === undefined && job.attempts >= 5)
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
          "kind": { $ne: "intent" },
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
