import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { Database } from "./schema.ts";

export interface Conversation {
  groupId: string;
  id: string;
  afterMessageId: number;
  summary: string;
  messages: AgentMessage[];
}

export class Conversations {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async open(groupId: string): Promise<Conversation> {
    await this.#db
      .insertInto("conversations")
      .values({
        groupId,
        id: randomUUID(),
        afterMessageId: 0,
        summary: "",
        messages: "[]",
      })
      .onConflict((conflict) => conflict.column("groupId").doNothing())
      .execute();
    const row = await this.#db
      .selectFrom("conversations")
      .selectAll()
      .where("groupId", "=", groupId)
      .executeTakeFirstOrThrow();

    return { ...row, messages: JSON.parse(row.messages) };
  }

  // 并行请求只追加自己的完整一轮，不用开始时的快照覆盖其他已完成的回复。
  public append(
    conversation: Conversation,
    turn: AgentMessage[],
  ): Promise<Conversation> {
    return this.#db.transaction().execute(async (db) => {
      const row = await db
        .selectFrom("conversations")
        .selectAll()
        .where("groupId", "=", conversation.groupId)
        .where("id", "=", conversation.id)
        .executeTakeFirst();

      assert.ok(row, "会话已更换，不能写回旧上下文");
      const messages: AgentMessage[] = [...JSON.parse(row.messages), ...turn];

      await db
        .updateTable("conversations")
        .set({ messages: JSON.stringify(messages) })
        .where("groupId", "=", row.groupId)
        .execute();

      return { ...row, messages };
    });
  }

  public compact(
    before: Conversation,
    summary: string,
    retained: AgentMessage[],
  ): Promise<boolean> {
    return this.#db.transaction().execute(async (db) => {
      const row = await db
        .selectFrom("conversations")
        .selectAll()
        .where("groupId", "=", before.groupId)
        .where("id", "=", before.id)
        .executeTakeFirst();

      if (row?.summary !== before.summary) {
        return false;
      }

      const current: AgentMessage[] = JSON.parse(row.messages);

      if (
        JSON.stringify(current.slice(0, before.messages.length)) !==
        JSON.stringify(before.messages)
      ) {
        return false;
      }

      // 压缩仅替换本次读到的前缀，保留压缩期间新完成的对话。
      await db
        .updateTable("conversations")
        .set({
          summary,
          messages: JSON.stringify([
            ...retained,
            ...current.slice(before.messages.length),
          ]),
        })
        .where("groupId", "=", before.groupId)
        .execute();

      return true;
    });
  }

  public async reset(groupId: string, afterMessageId: number): Promise<void> {
    const values = {
      groupId,
      id: randomUUID(),
      afterMessageId,
      summary: "",
      messages: "[]",
    };

    await this.#db
      .insertInto("conversations")
      .values(values)
      .onConflict((conflict) => conflict.column("groupId").doUpdateSet(values))
      .execute();
  }
}
