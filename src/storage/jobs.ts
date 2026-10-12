import { $ } from "koishi";

import type { Job, JobKind, JobPayloads } from "../types.ts";
import type { Database } from "./schema.ts";

export async function enqueueJob<K extends JobKind>(
  db: Database,
  kind: K,
  key: string,
  payload: JobPayloads[K],
  now = Date.now(),
): Promise<void> {
  const [existing] = await db.get("jobs", { key });

  if (!existing) {
    await db.create("jobs", { kind, key, payload, runAfter: now });
  } else if (
    kind === "summarize" &&
    "requested" in payload &&
    payload.requested &&
    existing.state !== "done"
  ) {
    await db.set("jobs", { id: existing.id }, { payload });
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

  public claim(now: number): Promise<Job | null> {
    return this.#db.transact(async (db) => {
      const [job] = await db
        .select("jobs", { state: "pending", runAfter: { $lte: now } })
        .orderBy((row) =>
          $.switch(
            [
              { case: $.eq(row.kind, "intent"), then: 0 },
              { case: $.eq(row.kind, "asset"), then: 1 },
              { case: $.eq(row.kind, "detect"), then: 2 },
            ],
            3,
          ),
        )
        .orderBy("id")
        .limit(1)
        .execute();

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
  ): Promise<void> {
    await this.#db.transact((db) =>
      db.set(
        "jobs",
        { id: job.id },
        {
          state:
            job.kind === "intent" || (after === undefined && job.attempts >= 5)
              ? "failed"
              : "pending",
          runAfter:
            after ??
            now + Math.min(300_000, 5000 * 2 ** Math.min(job.attempts, 6)),
          lastError: error,
        },
      ),
    );
  }

  public async retryFailed(groupId: string): Promise<number> {
    const result = await this.#db.transact((db) =>
      db.set(
        "jobs",
        { "state": "failed", "payload.groupId": groupId },
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
