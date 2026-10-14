import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

import type { Message, Topic } from "../types.ts";
import { StoreError, required } from "./errors.ts";
import { topicDirectory } from "./files.ts";
import { enqueueJob } from "./jobs.ts";
import { decodeMessage } from "./messages.ts";
import type { Database } from "./schema.ts";
import { linkMessages } from "./topic-sources.ts";

export class Topics {
  #db: Database;
  #directory: string;

  constructor(db: Database, directory: string) {
    this.#db = db;
    this.#directory = directory;
  }

  public find(groupId: string, id: string) {
    return this.#db
      .selectFrom("topics")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  public async page(
    groupId: string,
    options: { offset: number; limit: number; query?: string },
  ) {
    let query = this.#db.selectFrom("topics").where("groupId", "=", groupId);
    const text = options.query;

    if (text) {
      query = query.where((eb) =>
        eb.or([
          eb(eb.fn<number>("contains_text", ["title", eb.val(text)]), ">", 0),
          eb(
            eb.fn<number>("contains_text", ["description", eb.val(text)]),
            ">",
            0,
          ),
          eb(eb.fn<number>("contains_text", ["focus", eb.val(text)]), ">", 0),
        ]),
      );
    }

    const [items, total] = await Promise.all([
      query
        .selectAll()
        .orderBy("lastActiveAt", "desc")
        .offset(options.offset)
        .limit(options.limit)
        .execute(),
      query
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
    ]);

    return { items, total: total.count };
  }

  public async get(id: string): Promise<Topic> {
    const topic = await this.#db
      .selectFrom("topics")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    if (!topic) {
      throw new Error(`不存在的话题 ${id}`);
    }

    return topic;
  }

  public list(groupId: string, limit = 10): Promise<Topic[]> {
    return this.#db
      .selectFrom("topics")
      .selectAll()
      .where("groupId", "=", groupId)
      .orderBy("lastActiveAt", "desc")
      .limit(limit)
      .execute();
  }

  public automatic(groupId: string, since: number): Promise<Topic[]> {
    return this.#db
      .selectFrom("topics")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("mode", "=", "auto")
      .where("lastActiveAt", ">=", since)
      .orderBy("lastActiveAt", "desc")
      .execute();
  }

  public following(groupId: string, ownerId?: string): Promise<Topic[]> {
    let query = this.#db
      .selectFrom("topics")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("mode", "=", "manual")
      .where("state", "=", "active");

    if (ownerId !== undefined) {
      query = query.where("ownerId", "=", ownerId);
    }

    return query.execute();
  }

  public async commitDetection(
    groupId: string,
    through: number,
    assignments: {
      id: string;
      title: string;
      description: string;
      messageIds: number[];
    }[],
  ): Promise<void> {
    await this.#db.transaction().execute(async (db) => {
      for (const assignment of assignments) {
        const id = assignment.id.startsWith("new:")
          ? randomUUID()
          : assignment.id;

        if (assignment.id.startsWith("new:")) {
          await db
            .insertInto("topics")
            .values({
              id,
              groupId,
              title: assignment.title,
              mode: "auto",
              ownerId: null,
              lastActiveAt: 0,
            })
            .execute();
        } else {
          const topic = await db
            .selectFrom("topics")
            .select("groupId")
            .where("id", "=", id)
            .executeTakeFirst();

          assert.ok(topic);
          if (topic.groupId !== groupId) {
            throw new Error("话题属于其他群");
          }
        }

        await linkMessages(db, id, assignment.messageIds);
        await db
          .updateTable("topics")
          .set({ title: assignment.title, description: assignment.description })
          .where("id", "=", id)
          .execute();
      }

      await db
        .updateTable("groups")
        .set((eb) => ({
          cursor: eb.fn<number>("max", ["cursor", eb.val(through)]),
        }))
        .where("id", "=", groupId)
        .execute();
    });
  }

  public async messages(
    topicId: string,
    through = Number.MAX_SAFE_INTEGER,
  ): Promise<Message[]> {
    const rows = await this.#db
      .selectFrom("messages")
      .selectAll()
      .where(
        "id",
        "in",
        this.#db
          .selectFrom("topic_messages")
          .select("messageId")
          .where("topicId", "=", topicId),
      )
      .where("id", "<=", through)
      .orderBy("id")
      .execute();

    return rows.map(decodeMessage);
  }

  public async changedMessages(
    topicId: string,
    since: number,
  ): Promise<Set<number>> {
    const links = await this.#db
      .selectFrom("topic_messages")
      .select("messageId")
      .where("topicId", "=", topicId)
      .where("generation", ">", since)
      .execute();

    return new Set(links.map((link) => link.messageId));
  }

  public async setDirective(
    topicId: string,
    directive: Topic["directive"],
    messageId?: number,
  ): Promise<void> {
    await this.#db
      .updateTable("topics")
      .set({
        directive,
        ...(messageId === undefined ? {} : { directiveMessageId: messageId }),
      })
      .where("id", "=", topicId)
      .execute();
  }

  public ready(now: number, idle: number): Promise<Topic[]> {
    return this.#db
      .selectFrom("topics")
      .selectAll()
      .where("lastSourceId", ">", 0)
      .whereRef("generation", "!=", "noteGeneration")
      .where((eb) =>
        eb.or([
          eb.and([
            eb(
              "groupId",
              "in",
              this.#db
                .selectFrom("groups")
                .select("id")
                .where("aiEnabled", "=", 1),
            ),
            eb("mode", "=", "auto"),
            eb("lastActiveAt", "<=", now - idle),
          ]),
          eb.and([eb("mode", "=", "manual"), eb("state", "=", "closed")]),
        ]),
      )
      .execute();
  }

  public search(groupId: string, query: string): Promise<Topic[]> {
    return this.#db
      .selectFrom("topics")
      .selectAll()
      .where("groupId", "=", groupId)
      .where((eb) =>
        eb.or([
          eb(eb.fn<number>("instr", ["id", eb.val(query)]), ">", 0),
          eb(eb.fn<number>("instr", ["title", eb.val(query)]), ">", 0),
          eb(eb.fn<number>("instr", ["description", eb.val(query)]), ">", 0),
          eb(
            "id",
            "in",
            this.#db
              .selectFrom("notes")
              .select("topicId")
              .where("groupId", "=", groupId)
              .where((eb) =>
                eb(eb.fn<number>("instr", ["markdown", eb.val(query)]), ">", 0),
              ),
          ),
        ]),
      )
      .orderBy("lastActiveAt", "desc")
      .limit(10)
      .execute();
  }

  public regenerate(groupId: string, topicId: string, focus: string) {
    return this.#db.transaction().execute(async (db) => {
      const topic = required(
        await db
          .selectFrom("topics")
          .selectAll()
          .where("id", "=", topicId)
          .where("groupId", "=", groupId)
          .executeTakeFirst(),
      );
      const busy = await db
        .selectFrom("jobs")
        .select("id")
        .where("kind", "=", "summarize")
        .where("state", "in", ["pending", "running"])
        .where((eb) =>
          eb(
            eb.fn<string>("json_extract", ["payload", eb.val("$.topicId")]),
            "=",
            topicId,
          ),
        )
        .executeTakeFirst();

      if (busy !== undefined) {
        throw new StoreError("conflict", "这篇纪要正在排队或整理中");
      }

      const generation = topic.generation + 1;

      await db
        .updateTable("topics")
        .set({ generation, focus })
        .where("id", "=", topicId)
        .execute();
      await db
        .updateTable("topic_messages")
        .set({ generation })
        .where("topicId", "=", topicId)
        .execute();

      return enqueueJob(db, "summarize", `summarize:${topicId}:${generation}`, {
        groupId,
        topicId,
        requested: true,
        publish: false,
      });
    });
  }

  public remove(groupId: string, topicId: string): Promise<void> {
    return this.#db.transaction().execute(async (db) => {
      const topic = required(
        await db
          .selectFrom("topics")
          .selectAll()
          .where("id", "=", topicId)
          .where("groupId", "=", groupId)
          .executeTakeFirst(),
      );
      const busy = await db
        .selectFrom("jobs")
        .select("id")
        .where("state", "=", "running")
        .where((eb) =>
          eb(
            eb.fn<string>("json_extract", ["payload", eb.val("$.topicId")]),
            "=",
            topicId,
          ),
        )
        .executeTakeFirst();

      const publications = await db
        .selectFrom("jobs")
        .selectAll()
        .where("kind", "=", "publish")
        .where("state", "in", ["pending", "running", "failed"])
        .where((eb) =>
          eb(
            eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
            "=",
            groupId,
          ),
        )
        .execute();
      const affected = publications
        .map((job) => ({
          job,
          payload: JSON.parse(
            job.payload,
          ) as import("../types.ts").JobPayloads["publish"],
        }))
        .filter(({ payload }) =>
          payload.topics.some((topic) => topic.id === topicId),
        );

      if (
        busy !== undefined ||
        affected.some(({ job }) => job.state === "running")
      ) {
        throw new StoreError("conflict", "请先暂停 AI，再删除纪要");
      }

      for (const { job, payload } of affected) {
        payload.topics = payload.topics.filter((topic) => topic.id !== topicId);
        if (payload.topics.length === 0) {
          await db.deleteFrom("jobs").where("id", "=", job.id).execute();
        } else {
          await db
            .updateTable("jobs")
            .set({
              payload: JSON.stringify(payload),
              progress: `等待本批 ${payload.topics.length} 份纪要全部整理完毕后统一交付`,
            })
            .where("id", "=", job.id)
            .execute();
        }
      }

      await rm(topicDirectory(this.#directory, topic), {
        recursive: true,
        force: true,
      });
      await db
        .deleteFrom("deliveries")
        .where("topicId", "=", topicId)
        .execute();
      await db
        .deleteFrom("jobs")
        .where((eb) =>
          eb(
            eb.fn<string>("json_extract", ["payload", eb.val("$.topicId")]),
            "=",
            topicId,
          ),
        )
        .execute();
      await db.deleteFrom("notes").where("topicId", "=", topicId).execute();
      await db
        .deleteFrom("topic_messages")
        .where("topicId", "=", topicId)
        .execute();
      await db.deleteFrom("topics").where("id", "=", topicId).execute();
    });
  }
}
