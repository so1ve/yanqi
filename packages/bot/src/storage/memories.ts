import type { Memory, Message } from "../types.ts";
import type { Database } from "./schema.ts";

async function assertActive(db: Database, request: Message) {
  const [source] = await db.get("messages", { id: request.id });

  if (source!.recalledAt !== null) {
    throw new Error("这次请求已撤回");
  }
}

export class Memories {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async list(groupId: string, userId: string): Promise<Memory[]> {
    return (
      await this.#db.get(
        "memories",
        { groupId, userId },
        { sort: { updatedAt: "desc", key: "asc" } },
      )
    ).map((row) => ({
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
    await this.#db.transact(async (db) => {
      await assertActive(db, request);
      const current = await db.get(
        "memories",
        { groupId: request.groupId, userId: request.userId },
        ["key"],
      );

      if (current.length >= 40 && !current.some((item) => item.key === key)) {
        throw new Error("本群最多保存你的 40 项记忆，请先删除不再需要的条目");
      }

      await db.upsert("memories", [
        {
          groupId: request.groupId,
          userId: request.userId,
          key,
          content,
          sourceMessageId: request.id,
          updatedAt: Date.now(),
        },
      ]);
    });
  }

  public async forget(request: Message, key: string): Promise<boolean> {
    const result = await this.#db.transact(async (db) => {
      await assertActive(db, request);

      return db.remove("memories", {
        groupId: request.groupId,
        userId: request.userId,
        key,
      });
    });

    return Boolean(result.removed);
  }
}
