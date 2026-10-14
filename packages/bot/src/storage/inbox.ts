import type { Config } from "../config.ts";
import type { IncomingMessage, JobPayloads, Message } from "../types.ts";
import { captureAssets } from "./assets.ts";
import { enqueueJob } from "./jobs.ts";
import { decodeContent, encodeContent } from "./message-content.ts";
import type { Messages } from "./messages.ts";
import { decodeMessage } from "./messages.ts";
import type { Database } from "./schema.ts";
import { linkMessages } from "./topic-sources.ts";

export class Inbox {
  #db: Database;
  #config: Pick<Config, "ADMIN_IDS" | "GROUP_ADMINS">;
  #messages: Messages;

  constructor(
    db: Database,
    config: Pick<Config, "ADMIN_IDS" | "GROUP_ADMINS">,
    messages: Messages,
  ) {
    this.#db = db;
    this.#config = config;
    this.#messages = messages;
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
        // 自发消息事件可能先于发送接口返回；补上发送时选定的引用关系。
        if (
          input.isBot &&
          input.replyTo !== null &&
          existing.replyTo === null
        ) {
          await db
            .updateTable("messages")
            .set({ replyTo: input.replyTo })
            .where("id", "=", existing.id)
            .execute();
        }

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
        await captureAssets(db, message, input.content);

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

  public async getRequest(id: number): Promise<Message | null> {
    const message = await this.#messages.get(id);

    // 队列可能跨重启保留，读取时使用当前配置的名单。
    return message.recalledAt === null && this.#canInteract(message)
      ? message
      : null;
  }

  public async observe(message: Message, memoryOnly = false): Promise<void> {
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
            eb.fn<number>("coalesce", [
              eb.fn("json_extract", ["payload", eb.val("$.memoryOnly")]),
              eb.val(0),
            ]),
            "=",
            Number(memoryOnly),
          ),
        )
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
              messageIds: [...new Set([...payload.messageIds, message.id])],
            }),
          })
          .where("id", "=", pending.id)
          .execute();
      } else {
        // 从第一条消息起收集一秒，后续消息不延后处理时间。
        await enqueueJob(
          db,
          "observe",
          memoryOnly
            ? `observe-memory:${message.id}:${Date.now()}`
            : `observe:${message.id}`,
          {
            groupId: message.groupId,
            messageIds: [message.id],
            memoryOnly,
          },
          (memoryOnly ? Date.now() : message.receivedAt) + 1000,
        );
      }
    });
  }

  public async scheduleRequests(
    groupId: string,
    messageIds: number[],
  ): Promise<void> {
    if (messageIds.length === 0) {
      return;
    }

    await this.#db.transaction().execute(async (db) => {
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
    });
  }
}
