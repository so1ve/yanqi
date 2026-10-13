import assert from "node:assert/strict";

import type { Message } from "../types.ts";
import { beijingTime } from "../utils/time.ts";
import { decodeContent } from "./message-content.ts";
import type { Database, MessageRow } from "./schema.ts";
import { messageChanged } from "./topic-sources.ts";

export const decodeMessage = (row: MessageRow): Message => ({
  ...row,
  content: decodeContent(row.content),
  isBot: Boolean(row.isBot),
  addressed: Boolean(row.addressed),
  command: Boolean(row.command),
});

export interface MessageMetadata {
  id: number;
  userId: string;
  sentAt: number;
  textChars: number;
  attachmentCount: number;
}

export interface HistoryAvailability {
  messageCount: number;
  from: string | null;
  through: string | null;
}

export class Messages {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async get(id: number): Promise<Message> {
    const row = await this.#db
      .selectFrom("messages")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    if (!row) {
      throw new Error(`不存在的消息 m${id}`);
    }

    return decodeMessage(row);
  }

  public async quoted(
    groupId: string,
    messageId: string,
  ): Promise<Message | null> {
    const row = await this.#db
      .selectFrom("messages")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("messageId", "=", messageId)
      .executeTakeFirst();

    return row ? decodeMessage(row) : null;
  }

  public async recall(
    groupId: string,
    messageId: string,
    now: number,
  ): Promise<void> {
    await this.#db.transaction().execute(async (db) => {
      const message = await db
        .selectFrom("messages")
        .select(["id", "recalledAt"])
        .where("groupId", "=", groupId)
        .where("messageId", "=", messageId)
        .executeTakeFirst();

      if (message?.recalledAt !== null) {
        return;
      }

      await db
        .updateTable("messages")
        .set({ recalledAt: now })
        .where("id", "=", message.id)
        .execute();
      await db
        .deleteFrom("memories")
        .where("sourceMessageId", "=", message.id)
        .execute();
      await messageChanged(db, message.id);
    });
  }

  public async recent(
    groupId: string,
    limit: number,
    through = Number.MAX_SAFE_INTEGER,
  ): Promise<Message[]> {
    const rows = await this.#db
      .selectFrom("messages")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("id", "<=", through)
      .where("isBot", "=", 0)
      .orderBy("id", "desc")
      .limit(limit)
      .execute();

    return rows.reverse().map(decodeMessage);
  }

  public async conversation(
    groupId: string,
    limit: number,
    through: number,
    after = 0,
  ): Promise<Message[]> {
    const rows = await this.#db
      .selectFrom("messages")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("id", "<=", through)
      .where("id", ">", after)
      .orderBy("id", "desc")
      .limit(limit)
      .execute();

    return rows.reverse().map(decodeMessage);
  }

  public async availableHistory(
    groupId: string,
    beforeId: number,
  ): Promise<HistoryAvailability> {
    const range = await this.#db
      .selectFrom("messages")
      .where("groupId", "=", groupId)
      .where("id", "<", beforeId)
      .select((eb) => [
        eb.fn.countAll<number>().as("messageCount"),
        eb.fn.min<number | null>("sentAt").as("from"),
        eb.fn.max<number | null>("sentAt").as("through"),
      ])
      .executeTakeFirstOrThrow();

    return {
      messageCount: range.messageCount,
      from: range.from === null ? null : beijingTime(range.from),
      through: range.through === null ? null : beijingTime(range.through),
    };
  }

  public async listMetadata(
    groupId: string,
    through: number,
    {
      from = 0,
      to = Number.MAX_SAFE_INTEGER,
      fromId = 0,
      ids,
      topicIds,
      query,
      includeBot = false,
      limit,
    }: {
      from?: number;
      to?: number;
      fromId?: number;
      ids?: number[];
      topicIds?: string[];
      query?: string;
      includeBot?: boolean;
      limit?: number;
    } = {},
  ): Promise<MessageMetadata[]> {
    let selection = this.#db
      .selectFrom("messages")
      .select(["id", "userId", "sentAt"])
      .select((eb) => [
        eb.fn<number>("length", ["text"]).as("textChars"),
        eb
          .selectFrom("assets")
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .whereRef("assets.messageId", "=", "messages.id")
          .$asScalar()
          .as("attachmentCount"),
      ])
      .where("groupId", "=", groupId)
      .where("sentAt", ">=", from)
      .where("sentAt", "<", to)
      .where("id", ">=", fromId)
      .where("id", "<=", through)
      .orderBy("id", "desc");

    if (!includeBot) {
      selection = selection.where("isBot", "=", 0);
    }

    if (ids) {
      if (ids.length === 0) {
        return [];
      }

      selection = selection.where("id", "in", ids);
    }

    if (topicIds) {
      selection = selection.where(
        "id",
        "in",
        this.#db
          .selectFrom("topic_messages")
          .select("messageId")
          .where("topicId", "in", topicIds),
      );
    }

    if (query !== undefined) {
      selection = selection.where((eb) =>
        eb(eb.fn<number>("contains_text", ["text", eb.val(query)]), ">", 0),
      );
    }

    if (limit !== undefined) {
      selection = selection.limit(limit);
    }

    return (await selection.execute()).reverse();
  }

  public async nextDetection(
    groupId: string,
    limit: number,
  ): Promise<Message[]> {
    const group = await this.#db
      .selectFrom("groups")
      .select("cursor")
      .where("id", "=", groupId)
      .executeTakeFirst();

    assert.ok(group);
    const rows = await this.#db
      .selectFrom("messages")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("id", ">", group.cursor)
      .where("isBot", "=", 0)
      .orderBy("id")
      .limit(limit)
      .execute();

    return rows.map(decodeMessage);
  }

  public async getMany(ids: number[]): Promise<Message[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.#db
      .selectFrom("messages")
      .selectAll()
      .where("id", "in", ids)
      .orderBy("id")
      .execute();

    return rows.map(decodeMessage);
  }

  public async ids(groupId: string, text?: string): Promise<number[]> {
    let query = this.#db.selectFrom("messages").where("groupId", "=", groupId);

    if (text) {
      query = query.where((eb) =>
        eb(eb.fn<number>("contains_text", ["text", eb.val(text)]), ">", 0),
      );
    }

    const rows = await query
      .select("id")
      .orderBy("sentAt")
      .orderBy("id")
      .execute();

    return rows.map((row) => row.id);
  }

  public async read(groupId: string, ids: number[]): Promise<Message[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.#db
      .selectFrom("messages")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("id", "in", ids)
      .orderBy("sentAt")
      .orderBy("id")
      .execute();

    return rows.map(decodeMessage);
  }

  public async recordable(
    groupId: string,
    from: number,
    to: number,
  ): Promise<number[]> {
    const rows = await this.#db
      .selectFrom("messages")
      .select("id")
      .where("groupId", "=", groupId)
      .where("isBot", "=", 0)
      .where("command", "=", 0)
      .where("sentAt", ">=", from)
      .where("sentAt", "<=", to)
      .orderBy("id")
      .execute();

    return rows.map((row) => row.id);
  }

  public async names(
    groupId: string,
    userIds: string[],
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const rows = await this.#db
      .selectFrom("messages")
      .select(["userId", "displayName"])
      .where("id", "in", (eb) =>
        eb
          .selectFrom("messages")
          .select((eb) => eb.fn.max<number>("id").as("id"))
          .where("groupId", "=", groupId)
          .where("userId", "in", userIds)
          .groupBy("userId"),
      )
      .execute();

    return new Map(rows.map((row) => [row.userId, row.displayName]));
  }

  public quotes(groupId: string, messageIds: string[]) {
    if (messageIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.#db
      .selectFrom("messages")
      .select(["messageId", "displayName", "text", "recalledAt"])
      .where("groupId", "=", groupId)
      .where("messageId", "in", messageIds)
      .execute();
  }
}
