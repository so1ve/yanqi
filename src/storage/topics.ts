import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { $ } from "koishi";

import type { Message, Topic } from "../types.ts";
import type { Database } from "./schema.ts";
import { linkMessages } from "./topic-sources.ts";

export class Topics {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async get(id: string): Promise<Topic> {
    const [topic] = await this.#db.get("topics", { id });

    if (!topic) {
      throw new Error(`不存在的话题 ${id}`);
    }

    return topic;
  }

  public list(groupId: string, limit = 10): Promise<Topic[]> {
    return this.#db.get(
      "topics",
      { groupId },
      { sort: { lastActiveAt: "desc" }, limit },
    );
  }

  public automatic(groupId: string, since: number): Promise<Topic[]> {
    return this.#db.get(
      "topics",
      { groupId, mode: "auto", lastActiveAt: { $gte: since } },
      { sort: { lastActiveAt: "desc" } },
    );
  }

  public following(groupId: string, ownerId?: string): Promise<Topic[]> {
    return this.#db.get("topics", {
      groupId,
      mode: "manual",
      state: "active",
      ...(ownerId === undefined ? {} : { ownerId }),
    });
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
    await this.#db.transact(async (db) => {
      for (const assignment of assignments) {
        const id = assignment.id.startsWith("new:")
          ? randomUUID()
          : assignment.id;

        if (assignment.id.startsWith("new:")) {
          await db.create("topics", {
            id,
            groupId,
            title: assignment.title,
            mode: "auto",
            ownerId: null,
            lastActiveAt: 0,
          });
        } else {
          const [topic] = await db.get("topics", { id });

          assert.ok(topic);
          if (topic.groupId !== groupId) {
            throw new Error("话题属于其他群");
          }
        }

        await linkMessages(db, id, assignment.messageIds);
        await db.set(
          "topics",
          { id },
          { title: assignment.title, description: assignment.description },
        );
      }

      await db.set("groups", { id: groupId }, (row) => ({
        cursor: $.max([row.cursor, through]),
      }));
    });
  }

  public async messages(
    topicId: string,
    through = Number.MAX_SAFE_INTEGER,
  ): Promise<Message[]> {
    const links = await this.#db.get("topic_messages", { topicId });

    return this.#db.get(
      "messages",
      { id: { $in: links.map((link) => link.messageId), $lte: through } },
      { sort: { id: "asc" } },
    );
  }

  public async changedMessages(
    topicId: string,
    since: number,
  ): Promise<Set<number>> {
    const links = await this.#db.get(
      "topic_messages",
      { topicId, generation: { $gt: since } },
      ["messageId"],
    );

    return new Set(links.map((link) => link.messageId));
  }

  public async setDirective(
    topicId: string,
    directive: Topic["directive"],
    messageId: number,
  ): Promise<void> {
    await this.#db.transact((db) =>
      db.set(
        "topics",
        { id: topicId },
        { directive, directiveMessageId: messageId },
      ),
    );
  }

  public async ready(now: number, idle: number): Promise<Topic[]> {
    const groups = await this.#db.get("groups", { aiEnabled: true }, ["id"]);

    return this.#db
      .select("topics", {
        lastSourceId: { $gt: 0 },
        $or: [
          {
            groupId: groups.map((group) => group.id),
            mode: "auto",
            lastActiveAt: { $lte: now - idle },
          },
          { mode: "manual", state: "closed" },
        ],
      })
      .where((row) => $.ne(row.generation, row.noteGeneration))
      .execute();
  }

  public async search(groupId: string, query: string): Promise<Topic[]> {
    const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const notes = await this.#db.get("notes", { groupId, markdown: literal }, [
      "topicId",
    ]);

    return this.#db.get(
      "topics",
      {
        groupId,
        $or: [
          { id: literal },
          { title: literal },
          { description: literal },
          { id: notes.map((note) => note.topicId) },
        ],
      },
      { sort: { lastActiveAt: "desc" }, limit: 10 },
    );
  }
}
