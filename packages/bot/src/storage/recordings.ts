import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { Message, Topic } from "../types.ts";
import { enqueueJob } from "./jobs.ts";
import type { Database } from "./schema.ts";
import { linkMessages } from "./topic-sources.ts";

export class Recordings {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public createSummary(
    groupId: string,
    title: string,
    focus: string,
    messageIds: number[],
  ): Promise<{ topic: Topic; taskId: number }> {
    return this.#db.transaction().execute(async (db) => {
      const topic = await db
        .insertInto("topics")
        .values({
          id: randomUUID(),
          groupId,
          title,
          focus,
          mode: "manual",
          ownerId: null,
          state: "closed",
          lastActiveAt: Date.now(),
          directive: "hold",
          directiveMessageId: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await linkMessages(db, topic.id, messageIds);
      const saved = await db
        .selectFrom("topics")
        .selectAll()
        .where("id", "=", topic.id)
        .executeTakeFirstOrThrow();
      const taskId = await enqueueJob(
        db,
        "summarize",
        `summarize:${saved.id}:${saved.generation}`,
        {
          groupId,
          topicId: saved.id,
          requested: true,
          publish: false,
        },
      );

      return { topic: saved, taskId };
    });
  }

  public create(
    request: Message,
    options: {
      title: string;
      focus?: string;
      directive: Topic["directive"];
      messages: number[];
      following?: boolean;
    },
  ): Promise<Topic> {
    return this.#db.transaction().execute(async (db) => {
      const messages = [...options.messages];

      if (options.following) {
        const subsequent = await db
          .selectFrom("messages")
          .select("id")
          .where("groupId", "=", request.groupId)
          .where("id", ">", request.id)
          .where("isBot", "=", 0)
          .where("command", "=", 0)
          .execute();

        messages.push(...subsequent.map((message) => message.id));
      }

      const topic = await db
        .insertInto("topics")
        .values({
          id: randomUUID(),
          groupId: request.groupId,
          title: options.title,
          focus: options.focus ?? "",
          mode: "manual",
          ownerId: request.userId,
          state: options.following ? "active" : "closed",
          lastActiveAt: request.receivedAt,
          directive: options.directive,
          directiveMessageId: request.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await linkMessages(db, topic.id, messages);

      return db
        .selectFrom("topics")
        .selectAll()
        .where("id", "=", topic.id)
        .executeTakeFirstOrThrow();
    });
  }

  public stop(
    topicId: string,
    through: number,
    include: number[],
    directive?: Topic["directive"],
  ): Promise<Topic> {
    return this.#db.transaction().execute(async (db) => {
      const existing = await db
        .selectFrom("topics")
        .selectAll()
        .where("id", "=", topicId)
        .executeTakeFirst();

      assert.ok(existing);
      const endedAtMessageId = existing.endedAtMessageId ?? through;

      if (include.length > 0) {
        await linkMessages(
          db,
          topicId,
          include.filter((id) => id < endedAtMessageId),
        );
      }

      const topic = await db
        .selectFrom("topics")
        .selectAll()
        .where("id", "=", topicId)
        .executeTakeFirstOrThrow();
      const removed = await db
        .deleteFrom("topic_messages")
        .where("topicId", "=", topicId)
        .where("messageId", ">=", endedAtMessageId)
        .executeTakeFirst();

      if (removed.numDeletedRows > 0n) {
        const links = await db
          .selectFrom("topic_messages")
          .select("messageId")
          .where("topicId", "=", topicId)
          .execute();

        topic.lastSourceId = links.reduce(
          (latest, link) => Math.max(latest, link.messageId),
          0,
        );
        topic.generation++;
      }

      topic.state = "closed";
      topic.endedAtMessageId = endedAtMessageId;
      if (directive !== undefined) {
        topic.directive = directive;
        topic.directiveMessageId = through;
      }

      await db
        .updateTable("topics")
        .set({
          state: topic.state,
          lastSourceId: topic.lastSourceId,
          generation: topic.generation,
          endedAtMessageId,
          directive: topic.directive,
          directiveMessageId: topic.directiveMessageId,
        })
        .where("id", "=", topicId)
        .execute();

      return topic;
    });
  }

  public async lastStopped(
    groupId: string,
    ownerId: string,
  ): Promise<Topic | null> {
    return (
      (await this.#db
        .selectFrom("topics")
        .selectAll()
        .where("groupId", "=", groupId)
        .where("ownerId", "=", ownerId)
        .where("mode", "=", "manual")
        .where("state", "=", "closed")
        .where("endedAtMessageId", "is not", null)
        .orderBy("endedAtMessageId", "desc")
        .limit(1)
        .executeTakeFirst()) ?? null
    );
  }

  public revise(
    topicId: string,
    changes: { messageIds?: number[]; focus?: string },
  ): Promise<Topic> {
    return this.#db.transaction().execute(async (db) => {
      const topic = await db
        .selectFrom("topics")
        .selectAll()
        .where("id", "=", topicId)
        .executeTakeFirstOrThrow();

      if (changes.messageIds !== undefined) {
        const wanted = new Set(changes.messageIds);
        const links = await db
          .selectFrom("topic_messages")
          .select("messageId")
          .where("topicId", "=", topicId)
          .execute();
        const removed = links.filter((link) => !wanted.has(link.messageId));

        if (removed.length > 0) {
          await db
            .deleteFrom("topic_messages")
            .where("topicId", "=", topicId)
            .where(
              "messageId",
              "in",
              removed.map((link) => link.messageId),
            )
            .execute();
          await db
            .updateTable("topics")
            .set({
              generation: topic.generation + 1,
              lastSourceId: changes.messageIds.reduce(
                (latest, id) => Math.max(latest, id),
                0,
              ),
            })
            .where("id", "=", topicId)
            .execute();
        }

        await linkMessages(db, topicId, changes.messageIds);
      }

      const updated = await db
        .selectFrom("topics")
        .selectAll()
        .where("id", "=", topicId)
        .executeTakeFirstOrThrow();

      if (
        (changes.focus !== undefined && changes.focus !== topic.focus) ||
        updated.generation === topic.generation
      ) {
        updated.generation++;
        updated.focus = changes.focus ?? updated.focus;

        await db
          .updateTable("topics")
          .set({ focus: updated.focus, generation: updated.generation })
          .where("id", "=", topicId)
          .execute();
        // 修改要求或按原范围重做时，重新提取原文，避免复用旧正文。
        await db
          .updateTable("topic_messages")
          .set({ generation: updated.generation })
          .where("topicId", "=", topicId)
          .execute();
      }

      return updated;
    });
  }
}
