import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { Message, Topic } from "../types.ts";
import { decodeMessage } from "./messages.ts";
import type { Database } from "./schema.ts";
import { linkMessages } from "./topic-sources.ts";

export class Topics {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
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
    messageId: number,
  ): Promise<void> {
    await this.#db
      .updateTable("topics")
      .set({ directive, directiveMessageId: messageId })
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
}
