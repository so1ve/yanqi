import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getEventListeners, on } from "node:events";

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
  // 整理任务读取的是最新原文。同一话题正在排队或执行时，复用该任务。
  const summary =
    kind === "summarize" ? (payload as JobPayloads["summarize"]) : null;
  const active = summary
    ? await db
        .selectFrom("jobs")
        .selectAll()
        .where("kind", "=", "summarize")
        .where("state", "in", ["pending", "running"])
        .where((eb) =>
          eb(
            eb.fn<string>("json_extract", ["payload", eb.val("$.topicId")]),
            "=",
            summary.topicId,
          ),
        )
        .executeTakeFirst()
    : undefined;
  const existing =
    active ??
    (await db
      .selectFrom("jobs")
      .selectAll()
      .where("key", "=", key)
      .executeTakeFirst());
  let id: number;

  if (existing) {
    id = existing.id;
    if (summary && (active || summary.requested)) {
      const previous: JobPayloads["summarize"] = JSON.parse(existing.payload);
      const merged = {
        ...summary,
        requested: previous.requested || summary.requested,
        replyTo:
          summary.replyTo === undefined ? previous.replyTo : summary.replyTo,
        publish:
          previous.publish === false && !summary.requested
            ? false
            : previous.publish !== false || summary.publish !== false,
      };

      await db
        .updateTable("jobs")
        .set({
          payload: JSON.stringify(merged),
          ...(active
            ? {}
            : {
                state: "pending" as const,
                attempts: 0,
                runAfter: now,
                lastError: null,
              }),
        })
        .where("id", "=", id)
        .execute();
      if (merged.publish && (summary.requested || previous.publish === false)) {
        await enqueuePublication(
          db,
          merged.groupId,
          [{ id: merged.topicId, requested: merged.requested }],
          [],
          summary.replyTo,
        );
      }
    }

    return id;
  }

  const job = await db
    .insertInto("jobs")
    .values({ kind, key, payload: JSON.stringify(payload), runAfter: now })
    .returning("id")
    .executeTakeFirstOrThrow();

  id = job.id;
  if (summary && summary.publish !== false) {
    await enqueuePublication(
      db,
      summary.groupId,
      [{ id: summary.topicId, requested: summary.requested }],
      [],
      summary.replyTo,
    );
  }

  logger.info("任务 #%s 入队：kind=%s key=%s", id, kind, key);

  return id;
}

// 一个群尚未开始发布的纪要归为一批；工作队列清空后再统一决定如何交付。
async function enqueuePublication(
  db: Database,
  groupId: string,
  topics: JobPayloads["publish"]["topics"],
  requestIds: number[] = [],
  replyTo?: string | null,
): Promise<number | null> {
  // 只有当前请求交给后台的结果需要交付。旧发送指令不授权自动更新再次发群。
  topics = topics.filter((item) => item.requested);
  if (topics.length === 0) {
    return null;
  }

  const existing = await db
    .selectFrom("jobs")
    .selectAll()
    .where("kind", "=", "publish")
    .where("state", "=", "pending")
    .where((eb) =>
      eb(
        eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
        "=",
        groupId,
      ),
    )
    .executeTakeFirst();
  const previous: JobPayloads["publish"] = existing
    ? JSON.parse(existing.payload)
    : { groupId, topics: [], requestIds: [] };
  const merged = new Map(previous.topics.map((topic) => [topic.id, topic]));

  for (const topic of topics) {
    merged.set(topic.id, {
      id: topic.id,
      requested: topic.requested || merged.get(topic.id)?.requested === true,
    });
  }

  // 重新排队时沿用原批次的请求，不能把话题后来收到的请求归给旧引用。
  const currentRequests =
    requestIds.length > 0
      ? requestIds
      : (
          await db
            .selectFrom("topics")
            .select("directiveMessageId")
            .where(
              "id",
              "in",
              topics.map((topic) => topic.id),
            )
            .where("directiveMessageId", "is not", null)
            .execute()
        ).map((topic) => topic.directiveMessageId!);
  const payload = JSON.stringify({
    groupId,
    // 合并为一张卡片时采用最新请求选定的引用；旧批次重排不能覆盖新选择。
    replyTo:
      replyTo !== undefined &&
      Math.max(0, ...currentRequests) >= Math.max(0, ...previous.requestIds)
        ? replyTo
        : (previous.replyTo ?? null),
    topics: [...merged.values()],
    requestIds: [...new Set([...previous.requestIds, ...currentRequests])],
  });
  const progress = `等待本批 ${merged.size} 份纪要全部整理完毕后统一交付`;

  if (existing) {
    await db
      .updateTable("jobs")
      .set({ payload, progress })
      .where("id", "=", existing.id)
      .execute();

    return existing.id;
  }

  const job = await db
    .insertInto("jobs")
    .values({
      kind: "publish",
      key: `publish:${groupId}:${randomUUID()}`,
      payload,
      progress,
      runAfter: Date.now(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return job.id;
}

export class JobQueue {
  #db: Database;
  #changes = new EventTarget();

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

    const topics = await this.#db
      .selectFrom("topics")
      .select(["id", "title"])
      .where("groupId", "=", groupId)
      .execute();
    const titles = new Map(topics.map((topic) => [topic.id, topic.title]));

    return {
      items: items.map((row) => {
        const job = decodeJob(row);

        return {
          ...job,
          progress:
            job.progress ??
            (job.kind === "summarize" && "topicId" in job.payload
              ? `等待整理「${titles.get(job.payload.topicId) ?? job.payload.topicId}」`
              : null),
        };
      }),
      total: total.count,
    };
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
    replyTo?: string | null,
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
        ...(replyTo === undefined ? {} : { replyTo }),
      },
    );
  }

  public publish(
    groupId: string,
    topics: JobPayloads["publish"]["topics"],
    requestIds: number[] = [],
    replyTo?: string | null,
  ) {
    return this.#db
      .transaction()
      .execute((db) =>
        enqueuePublication(db, groupId, topics, requestIds, replyTo),
      );
  }

  public async recordingBusy(groupId: string): Promise<boolean> {
    return (
      (await this.#db
        .selectFrom("jobs")
        .select("id")
        .where("kind", "in", ["intent", "detect", "summarize"])
        .where("state", "in", ["pending", "running"])
        .where((eb) =>
          eb(
            eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
            "=",
            groupId,
          ),
        )
        .executeTakeFirst()) !== undefined
    );
  }

  public async publishesRequest(
    groupId: string,
    requestId: number,
  ): Promise<boolean> {
    const jobs = await this.#db
      .selectFrom("jobs")
      .select("payload")
      .where("kind", "=", "publish")
      .where("state", "in", ["pending", "running"])
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
          "=",
          groupId,
        ),
      )
      .execute();

    return jobs.some(({ payload }) =>
      (JSON.parse(payload) as JobPayloads["publish"]).requestIds.includes(
        requestId,
      ),
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
          Number(getEventListeners(this.#changes, String(b.id)).length > 0) -
          Number(getEventListeners(this.#changes, String(a.id)).length > 0),
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
      const busyPublications =
        kind === "publish"
          ? await db
              .selectFrom("jobs")
              .select((eb) =>
                eb
                  .fn<string>("json_extract", ["payload", eb.val("$.groupId")])
                  .as("groupId"),
              )
              .where("kind", "in", ["intent", "detect", "summarize"])
              .where("state", "in", ["pending", "running"])
              .execute()
          : [];
      const detecting =
        kind === "summarize"
          ? await db
              .selectFrom("jobs")
              .select((eb) =>
                eb
                  .fn<string>("json_extract", ["payload", eb.val("$.groupId")])
                  .as("groupId"),
              )
              .where("kind", "=", "detect")
              .where("state", "in", ["pending", "running"])
              .execute()
          : [];
      const job = pending.find(({ payload }) => {
        if (kind === "publish") {
          return !busyPublications.some(
            (group) => group.groupId === payload.groupId,
          );
        }

        if (kind === "detect") {
          return !pausedGroups.includes(payload.groupId);
        }

        if (kind === "intent") {
          return !busyGroups.some((group) => group.groupId === payload.groupId);
        }

        return (
          kind !== "summarize" ||
          ("topicId" in payload &&
            (payload.requested ||
              (!pausedTopics.includes(payload.topicId) &&
                !detecting.some((group) => group.groupId === payload.groupId))))
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
      .where("kind", "not in", ["intent", "observe", "memory"])
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

  public async restart(
    groupId: string,
    id: number,
    requestId?: number,
  ): Promise<number | null> {
    return this.#db.transaction().execute(async (db) => {
      const row = await db
        .selectFrom("jobs")
        .selectAll()
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

      if (!row) {
        return null;
      }

      if (row.kind === "summarize") {
        const payload: JobPayloads["summarize"] = JSON.parse(row.payload);
        const target = await enqueueJob(db, "summarize", row.key, {
          ...payload,
          requested: payload.requested || requestId !== undefined,
        });

        if (payload.publish !== false && requestId !== undefined) {
          await enqueuePublication(
            db,
            groupId,
            [{ id: payload.topicId, requested: true }],
            [requestId],
          );
        }

        if (target !== row.id) {
          await db
            .updateTable("jobs")
            .set({
              state: "done",
              lastError: null,
              progress: `已合并到任务 #${target}`,
            })
            .where("id", "=", row.id)
            .execute();
        }

        return target;
      }

      if (row.kind === "publish") {
        const payload: JobPayloads["publish"] = JSON.parse(row.payload);
        const target = await enqueuePublication(
          db,
          groupId,
          payload.topics.map((topic) => ({
            ...topic,
            requested: topic.requested || requestId !== undefined,
          })),
          [
            ...payload.requestIds,
            ...(requestId === undefined ? [] : [requestId]),
          ],
        );

        await db
          .updateTable("jobs")
          .set({
            state: "done",
            lastError: null,
            progress:
              target === null ? "无需发送群消息" : `已合并到任务 #${target}`,
          })
          .where("id", "=", id)
          .execute();

        return target;
      }

      await db
        .updateTable("jobs")
        .set({
          state: "pending",
          attempts: 0,
          runAfter: Date.now(),
          lastError: null,
          progress: null,
        })
        .where("id", "=", id)
        .execute();

      return id;
    });
  }

  public async wait(groupId: string, id: number, signal?: AbortSignal) {
    // 先订阅再读取，避免任务恰好在读取期间完成而漏掉通知。
    const changes = on(this.#changes, String(id), { signal });

    try {
      while (true) {
        signal?.throwIfAborted();
        const job = await this.get(groupId, id);

        if (
          job.kind === "intent" ||
          job.kind === "observe" ||
          job.kind === "publish"
        ) {
          throw new Error("不能等待对话或发布任务，请等待附件或纪要任务");
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
    this.#changes.dispatchEvent(new Event(String(id)));
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
      this.#changes.dispatchEvent(new Event(String(id)));
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
    this.#changes.dispatchEvent(new Event(String(job.id)));
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
    { after, retryable = true }: { after?: number; retryable?: boolean } = {},
  ): Promise<{ state: "failed" | "pending"; runAfter: number }> {
    const state =
      !retryable ||
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
    this.#changes.dispatchEvent(new Event(String(job.id)));

    return { state, runAfter };
  }

  public async retryFailed(
    groupId: string,
    requestId?: number,
  ): Promise<number> {
    const rows = await this.#db
      .selectFrom("jobs")
      .select("id")
      .where("kind", "not in", ["intent", "observe"])
      .where("state", "=", "failed")
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
          "=",
          groupId,
        ),
      )
      .execute();
    const restarted = new Set<number>();

    for (const row of rows) {
      const id = await this.restart(groupId, row.id, requestId);

      if (id !== null) {
        restarted.add(id);
      }
    }

    return restarted.size;
  }
}
