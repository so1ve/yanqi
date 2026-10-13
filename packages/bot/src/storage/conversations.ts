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

  public async save(conversation: Conversation): Promise<void> {
    const result = await this.#db
      .updateTable("conversations")
      .set({
        summary: conversation.summary,
        messages: JSON.stringify(conversation.messages),
      })
      .where("groupId", "=", conversation.groupId)
      .where("id", "=", conversation.id)
      .executeTakeFirstOrThrow();

    assert.equal(result.numUpdatedRows, 1n, "会话已更换，不能写回旧上下文");
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
