import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { Message, Topic } from "../types.ts";
import type { Database } from "./schema.ts";
import { linkMessages } from "./topic-sources.ts";

export class Recordings {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public create(
    request: Message,
    options: {
      title: string;
      focus?: string;
      directive: Topic["directive"];
      messages: number[] | "following";
    },
  ): Promise<Topic> {
    return this.#db.transact(async (db) => {
      const continuous = options.messages === "following";
      const messages =
        options.messages === "following"
          ? (
              await db.get(
                "messages",
                {
                  groupId: request.groupId,
                  id: { $gt: request.id },
                  isBot: false,
                  command: false,
                },
                ["id"],
              )
            ).map((message) => message.id)
          : options.messages;
      const topic = await db.create("topics", {
        id: randomUUID(),
        groupId: request.groupId,
        title: options.title,
        focus: options.focus ?? "",
        mode: "manual",
        ownerId: request.userId,
        state: continuous ? "active" : "closed",
        lastActiveAt: request.receivedAt,
        directive: options.directive,
        directiveMessageId: request.id,
      });

      await linkMessages(db, topic.id, messages);
      const [linked] = await db.get("topics", { id: topic.id });

      assert.ok(linked);

      return linked;
    });
  }

  public stop(
    topicId: string,
    through: number,
    include: number[],
    directive?: Topic["directive"],
  ): Promise<Topic> {
    return this.#db.transact(async (db) => {
      const [existing] = await db.get("topics", { id: topicId });

      assert.ok(existing);
      const endedAtMessageId = existing.endedAtMessageId ?? through;

      if (include.length > 0) {
        await linkMessages(
          db,
          topicId,
          include.filter((id) => id < endedAtMessageId),
        );
      }

      const [topic] = await db.get("topics", { id: topicId });

      assert.ok(topic);
      const removed = await db.remove("topic_messages", {
        topicId,
        messageId: { $gte: endedAtMessageId },
      });

      if (removed.removed) {
        const links = await db.get("topic_messages", { topicId }, [
          "messageId",
        ]);

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

      await db.set(
        "topics",
        { id: topicId },
        {
          state: topic.state,
          lastSourceId: topic.lastSourceId,
          generation: topic.generation,
          endedAtMessageId,
          directive: topic.directive,
          directiveMessageId: topic.directiveMessageId,
        },
      );

      return topic;
    });
  }

  public async lastStopped(
    groupId: string,
    ownerId: string,
  ): Promise<Topic | null> {
    const [topic] = await this.#db.get(
      "topics",
      {
        groupId,
        ownerId,
        mode: "manual",
        state: "closed",
        endedAtMessageId: { $exists: true },
      },
      { sort: { endedAtMessageId: "desc" }, limit: 1 },
    );

    return topic ?? null;
  }

  public revise(
    topicId: string,
    changes: { messageIds?: number[]; focus?: string },
  ): Promise<Topic> {
    return this.#db.transact(async (db) => {
      const [topic] = await db.get("topics", { id: topicId });

      assert.ok(topic);
      if (changes.messageIds !== undefined) {
        const wanted = new Set(changes.messageIds);
        const links = await db.get("topic_messages", { topicId });
        const removed = links.filter((link) => !wanted.has(link.messageId));

        if (removed.length > 0) {
          await db.remove("topic_messages", {
            topicId,
            messageId: removed.map((link) => link.messageId),
          });
          await db.set(
            "topics",
            { id: topicId },
            {
              generation: topic.generation + 1,
              lastSourceId: changes.messageIds.reduce(
                (latest, id) => Math.max(latest, id),
                0,
              ),
            },
          );
        }

        await linkMessages(db, topicId, changes.messageIds);
      }

      if (changes.focus !== undefined && changes.focus !== topic.focus) {
        const [current] = await db.get("topics", { id: topicId });
        const generation = current!.generation + 1;

        await db.set(
          "topics",
          { id: topicId },
          { focus: changes.focus, generation },
        );
        // 选材要求改变后，旧段落不能继续复用。
        await db.set("topic_messages", { topicId }, { generation });
      }

      const [updated] = await db.get("topics", { id: topicId });

      return updated!;
    });
  }
}
