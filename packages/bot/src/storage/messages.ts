import assert from "node:assert/strict";

import type { Config } from "../config.ts";
import type { IncomingMessage, JobPayloads, Message } from "../types.ts";
import { beijingTime } from "../utils/time.ts";
import { enqueueJob } from "./jobs.ts";
import { decodeContent, encodeContent } from "./message-content.ts";
import type { Database, MessageRow } from "./schema.ts";
import { linkMessages, messageChanged } from "./topic-sources.ts";

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
  #config: Pick<Config, "ADMIN_IDS" | "GROUP_ADMINS">;

  constructor(
    db: Database,
    config: Pick<Config, "ADMIN_IDS" | "GROUP_ADMINS">,
  ) {
    this.#db = db;
    this.#config = config;
  }

  #canInteract(message: IncomingMessage | Message): boolean {
    return (
      !message.isBot &&
      (this.#config.ADMIN_IDS.includes(message.userId) ||
        (this.#config.GROUP_ADMINS[message.groupId]?.includes(message.userId) ??
          false) ||
        message.role === "owner" ||
        message.role === "admin")
    );
  }

  public capture(input: IncomingMessage): Promise<Message | null> {
    return this.#db.transaction().execute(async (db) => {
      const existing = await db
        .selectFrom("messages")
        .selectAll()
        .where("groupId", "=", input.groupId)
        .where("messageId", "=", input.messageId)
        .executeTakeFirst();

      if (existing) {
        if (input.noteId !== undefined) {
          await db
            .updateTable("messages")
            .set({ noteId: input.noteId })
            .where("id", "=", existing.id)
            .execute();
        }

        if (
          input.isBot &&
          decodeContent(existing.content).length === 0 &&
          input.content.length > 0
        ) {
          await db
            .updateTable("messages")
            .set({ content: encodeContent(input.content) })
            .where("id", "=", existing.id)
            .execute();
        }

        return null;
      }

      const canInteract = this.#canInteract(input);
      const quote =
        canInteract && input.replyTo
          ? await db
              .selectFrom("messages")
              .select("id")
              .where("groupId", "=", input.groupId)
              .where("messageId", "=", input.replyTo)
              .where("isBot", "=", 1)
              .executeTakeFirst()
          : undefined;
      const command = canInteract && (input.addressed || quote !== undefined);

      const message = decodeMessage(
        await db
          .insertInto("messages")
          .values({
            ...input,
            content: encodeContent(input.content),
            isBot: Number(input.isBot),
            addressed: Number(input.addressed),
            command: Number(command),
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );

      if (!input.isBot) {
        for (const segment of input.content) {
          const kind = segment.type === "record" ? "audio" : segment.type;

          if (
            kind !== "audio" &&
            kind !== "file" &&
            kind !== "forward" &&
            kind !== "image" &&
            kind !== "video"
          ) {
            continue;
          }

          const reference = String(
            segment.data.url ||
              segment.data.id ||
              segment.data.file_id ||
              segment.data.file ||
              "",
          );

          if (!reference) {
            continue;
          }

          const asset = await db
            .insertInto("assets")
            .values({ messageId: message.id, kind, reference })
            .onConflict((conflict) =>
              conflict.columns(["messageId", "kind", "reference"]).doNothing(),
            )
            .returning("id")
            .executeTakeFirst();

          if (asset) {
            await enqueueJob(db, "asset", `asset:${asset.id}`, {
              assetId: asset.id,
              groupId: input.groupId,
            });
          }
        }

        if (!command) {
          const topics = await db
            .selectFrom("topics")
            .select("id")
            .where("groupId", "=", input.groupId)
            .where("mode", "=", "manual")
            .where("state", "=", "active")
            .execute();

          for (const topic of topics) {
            await linkMessages(db, topic.id, [message.id]);
          }
        }
      }

      return message;
    });
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

  public async getRequest(id: number): Promise<Message | null> {
    const message = await this.get(id);

    // 队列可能跨重启保留，读取时使用当前配置的名单。
    return message.recalledAt === null && this.#canInteract(message)
      ? message
      : null;
  }

  public async observe(message: Message): Promise<void> {
    if (!this.#canInteract(message)) {
      return;
    }

    await this.#db.transaction().execute(async (db) => {
      const pending = await db
        .selectFrom("jobs")
        .selectAll()
        .where("kind", "=", "observe")
        .where("state", "=", "pending")
        .where((eb) =>
          eb(
            eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
            "=",
            message.groupId,
          ),
        )
        .executeTakeFirst();

      if (pending) {
        const payload: JobPayloads["observe"] = JSON.parse(pending.payload);

        await db
          .updateTable("jobs")
          .set({
            payload: JSON.stringify({
              ...payload,
              messageIds: [...payload.messageIds, message.id],
            }),
          })
          .where("id", "=", pending.id)
          .execute();
      } else {
        // 从第一条消息起收集一秒，后续消息不延后处理时间。
        await enqueueJob(
          db,
          "observe",
          `observe:${message.id}`,
          {
            groupId: message.groupId,
            messageIds: [message.id],
          },
          message.receivedAt + 1000,
        );
      }
    });
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
  ): Promise<Message[]> {
    const rows = await this.#db
      .selectFrom("messages")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("id", "<=", through)
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

  public async scheduleRequests(
    groupId: string,
    messageIds: number[],
  ): Promise<Message[]> {
    if (messageIds.length === 0) {
      return [];
    }

    return this.#db.transaction().execute(async (db) => {
      const rows = await db
        .selectFrom("messages")
        .selectAll()
        .where("groupId", "=", groupId)
        .where("id", "in", messageIds)
        .where("isBot", "=", 0)
        .where("command", "=", 0)
        .where("recalledAt", "is", null)
        .execute();
      const requests = rows
        .map(decodeMessage)
        .filter((message) => this.#canInteract(message));

      for (const message of requests) {
        await db
          .updateTable("messages")
          .set({ command: 1 })
          .where("id", "=", message.id)
          .execute();
        await enqueueJob(db, "intent", `intent:${message.id}`, {
          groupId,
          messageId: message.id,
        });
      }

      return requests.map((message) => ({ ...message, command: true }));
    });
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
}
