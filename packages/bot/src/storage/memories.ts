import type { Memory, Message } from "../types.ts";
import type { Database } from "./schema.ts";

async function assertActive(db: Database, request: Message) {
  const source = await db
    .selectFrom("messages")
    .select("recalledAt")
    .where("id", "=", request.id)
    .executeTakeFirstOrThrow();

  if (source.recalledAt !== null) {
    throw new Error("这次请求已撤回");
  }
}

export class Memories {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async list(groupId: string, userId: string): Promise<Memory[]> {
    const rows = await this.#db
      .selectFrom("memories")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("userId", "=", userId)
      .orderBy("updatedAt", "desc")
      .orderBy("key")
      .execute();

    return rows.map((row) => ({
      key: row.key,
      content: row.content,
      sourceId: row.sourceMessageId === null ? null : `m${row.sourceMessageId}`,
      updatedAt: row.updatedAt,
    }));
  }

  public async remember(
    request: Message,
    key: string,
    content: string,
  ): Promise<void> {
    await this.#db.transaction().execute(async (db) => {
      await assertActive(db, request);
      const current = await db
        .selectFrom("memories")
        .select("key")
        .where("groupId", "=", request.groupId)
        .where("userId", "=", request.userId)
        .execute();

      if (current.length >= 40 && !current.some((item) => item.key === key)) {
        throw new Error("本群最多保存你的 40 项记忆，请先删除不再需要的条目");
      }

      const values = {
        groupId: request.groupId,
        userId: request.userId,
        key,
        content,
        sourceMessageId: request.id,
        updatedAt: Date.now(),
      };

      await db
        .insertInto("memories")
        .values(values)
        .onConflict((conflict) =>
          conflict.columns(["groupId", "userId", "key"]).doUpdateSet(values),
        )
        .execute();
    });
  }

  public async forget(request: Message, key: string): Promise<boolean> {
    return this.#db.transaction().execute(async (db) => {
      await assertActive(db, request);
      const result = await db
        .deleteFrom("memories")
        .where("groupId", "=", request.groupId)
        .where("userId", "=", request.userId)
        .where("key", "=", key)
        .executeTakeFirst();

      return result.numDeletedRows > 0n;
    });
  }
}
