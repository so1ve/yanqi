import assert from "node:assert/strict";

import type { IncomingMessage, Message } from "../types.ts";
import { enqueueJob } from "./jobs.ts";
import type { Database } from "./schema.ts";
import { linkMessages, messageChanged } from "./topic-sources.ts";

export class Messages {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public capture(input: IncomingMessage): Promise<Message | null> {
    return this.#db.transact(async (db) => {
      const [existing] = await db.get("messages", {
        groupId: input.groupId,
        messageId: input.messageId,
      });

      if (existing) {
        if (input.noteId !== undefined) {
          await db.set(
            "messages",
            { id: existing.id },
            { noteId: input.noteId },
          );
        }

        if (
          input.isBot &&
          JSON.parse(existing.rawJson).source === "yanqi-send" &&
          (input.raw as { source?: string }).source !== "yanqi-send"
        ) {
          await db.set(
            "messages",
            { id: existing.id },
            { rawJson: JSON.stringify(input.raw), segments: input.segments },
          );
        }

        return null;
      }

      const waiting = input.isBot
        ? []
        : await db.get("messages", {
            groupId: input.groupId,
            userId: input.userId,
            awaitingReply: true,
            recalledAt: { $exists: false },
          });
      const quote = input.replyTo
        ? await db.get("messages", {
            groupId: input.groupId,
            messageId: input.replyTo,
            isBot: true,
          })
        : [];
      const command =
        !input.isBot &&
        (input.addressed || waiting.length > 0 || quote.length > 0);

      if (waiting.length > 0) {
        await db.set(
          "messages",
          { id: waiting.map((item) => item.id) },
          { awaitingReply: false },
        );
      }

      const { raw, ...fields } = input;
      const message = await db.create("messages", {
        ...fields,
        rawJson: JSON.stringify(raw),
        command,
      });

      if (!input.isBot) {
        for (const segment of input.segments) {
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

          const [existingAsset] = await db.get("assets", {
            messageId: message.id,
            kind,
            reference,
          });

          if (existingAsset) {
            continue;
          }

          const asset = await db.create("assets", {
            messageId: message.id,
            kind,
            reference,
          });

          await enqueueJob(db, "asset", `asset:${asset.id}`, {
            assetId: asset.id,
            groupId: input.groupId,
          });
        }

        if (command) {
          await enqueueJob(db, "intent", `intent:${message.id}`, {
            groupId: input.groupId,
            messageId: message.id,
          });
        } else {
          const topics = await db.get("topics", {
            groupId: input.groupId,
            mode: "manual",
            state: "active",
          });

          for (const topic of topics) {
            await linkMessages(db, topic.id, [message.id]);
          }
        }
      }

      return message;
    });
  }

  public async get(id: number): Promise<Message> {
    const [message] = await this.#db.get("messages", { id });

    if (!message) {
      throw new Error(`不存在的消息 m${id}`);
    }

    return message;
  }

  public async awaitReply(request: Message): Promise<void> {
    await this.#db.transact(async (db) => {
      const [next] = await db.get(
        "messages",
        {
          groupId: request.groupId,
          userId: request.userId,
          id: { $gt: request.id },
          recalledAt: { $exists: false },
        },
        { sort: { id: "asc" }, limit: 1 },
      );

      if (next) {
        await db.set("messages", { id: next.id }, { command: true });
        await enqueueJob(db, "intent", `intent:${next.id}`, {
          groupId: next.groupId,
          messageId: next.id,
        });
      } else {
        await db.set("messages", { id: request.id }, { awaitingReply: true });
      }
    });
  }

  public async quoted(
    groupId: string,
    messageId: string,
  ): Promise<Message | null> {
    const [message] = await this.#db.get("messages", { groupId, messageId });

    return message ?? null;
  }

  public async recall(
    groupId: string,
    messageId: string,
    now: number,
  ): Promise<void> {
    await this.#db.transact(async (db) => {
      const [message] = await db.get("messages", { groupId, messageId });

      if (message?.recalledAt !== null) {
        return;
      }

      await db.set("messages", { id: message.id }, { recalledAt: now });
      await db.remove("memories", { sourceMessageId: message.id });
      await messageChanged(db, message.id);
    });
  }

  public async recent(
    groupId: string,
    limit: number,
    through = Number.MAX_SAFE_INTEGER,
  ): Promise<Message[]> {
    const messages = await this.#db.get(
      "messages",
      { groupId, id: { $lte: through }, isBot: false },
      { sort: { id: "desc" }, limit },
    );

    return messages.reverse();
  }

  public async conversation(
    groupId: string,
    limit: number,
    through: number,
  ): Promise<Message[]> {
    const messages = await this.#db.get(
      "messages",
      { groupId, id: { $lte: through } },
      { sort: { id: "desc" }, limit },
    );

    return messages.reverse();
  }

  public history(
    groupId: string,
    through: number,
    {
      from = 0,
      to = Number.MAX_SAFE_INTEGER,
      fromId = 0,
    }: {
      from?: number;
      to?: number;
      fromId?: number;
    } = {},
  ): Promise<Message[]> {
    return this.#db.get(
      "messages",
      {
        groupId,
        sentAt: { $gte: from, $lt: to },
        id: { $gte: fromId, $lte: through },
        isBot: false,
      },
      { sort: { id: "asc" } },
    );
  }

  public async nextDetection(
    groupId: string,
    limit: number,
  ): Promise<Message[]> {
    const [group] = await this.#db.get("groups", { id: groupId });

    assert.ok(group);

    return this.#db.get(
      "messages",
      { groupId, id: { $gt: group.cursor }, isBot: false },
      { sort: { id: "asc" }, limit },
    );
  }

  public async scheduleRequests(
    groupId: string,
    messageIds: number[],
  ): Promise<void> {
    if (messageIds.length === 0) {
      return;
    }

    await this.#db.transact(async (db) => {
      const messages = await db.get("messages", {
        groupId,
        id: messageIds,
        isBot: false,
        command: false,
        recalledAt: { $exists: false },
      });

      for (const message of messages) {
        await db.set("messages", { id: message.id }, { command: true });
        await enqueueJob(db, "intent", `intent:${message.id}`, {
          groupId,
          messageId: message.id,
        });
      }
    });
  }

  public search(
    groupId: string,
    query: string,
    through: number,
  ): Promise<Message[]> {
    const literal = new RegExp(
      query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );

    return this.#db.get(
      "messages",
      {
        groupId,
        id: { $lte: through },
        isBot: false,
        text: literal,
      },
      { sort: { id: "desc" }, limit: 8 },
    );
  }
}
