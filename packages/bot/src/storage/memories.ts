import { Type } from "typebox";

import type { Memory, MemoryIndex, MemoryOwner } from "../types.ts";
import type { Database } from "./schema.ts";

export const memoryScope = Type.Enum(["group", "user"]);
export const memoryKey = Type.String({
  minLength: 1,
  maxLength: 60,
  pattern: "\\S",
});
export const memorySummary = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: "\\S",
  description:
    "压缩后的简介，保留事项当前状态或偏好的适用条件；不复制全部详情。",
});
export const memoryContent = Type.String({
  minLength: 1,
  maxLength: 4000,
  pattern: "\\S",
});
export const memoryOwner = {
  scope: memoryScope,
  ownerId: Type.String({ pattern: "^\\d+$" }),
};

async function assertActive(db: Database, sourceMessageId: number | null) {
  if (sourceMessageId === null) {
    return;
  }

  const source = await db
    .selectFrom("messages")
    .select(["id", "recalledAt", "receivedAt"])
    .where("id", "=", sourceMessageId)
    .executeTakeFirstOrThrow();

  if (source.recalledAt !== null) {
    throw new Error("这次请求已撤回");
  }

  return source;
}

export class Memories {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async page(options: {
    scope: MemoryOwner["scope"];
    ownerId?: string;
    query?: string;
    offset: number;
    limit: number;
  }) {
    let query = this.#db
      .selectFrom("memories")
      .where("scope", "=", options.scope);

    if (options.ownerId) {
      query = query.where("ownerId", "=", options.ownerId);
    }

    const text = options.query;

    if (text) {
      query = query.where((eb) =>
        eb.or([
          eb(eb.fn<number>("contains_text", ["content", eb.val(text)]), ">", 0),
          eb(eb.fn<number>("contains_text", ["summary", eb.val(text)]), ">", 0),
          eb(eb.fn<number>("contains_text", ["key", eb.val(text)]), ">", 0),
          eb(eb.fn<number>("instr", ["ownerId", eb.val(text)]), ">", 0),
        ]),
      );
    }

    const [items, total] = await Promise.all([
      query
        .selectAll()
        .orderBy("updatedAt", "desc")
        .offset(options.offset)
        .limit(options.limit)
        .execute(),
      query
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
    ]);

    return { items, total: total.count };
  }

  public async read(
    { scope, ownerId }: MemoryOwner,
    keys: string[],
  ): Promise<Memory[]> {
    return this.#db
      .selectFrom("memories")
      .selectAll()
      .where("scope", "=", scope)
      .where("ownerId", "=", ownerId)
      .where("key", "in", keys)
      .orderBy("key")
      .execute();
  }

  public async index(
    groupId: string,
    userId?: string | null,
  ): Promise<MemoryIndex> {
    const entries = await this.#db
      .selectFrom("memories")
      .select(["scope", "key", "summary"])
      .where((eb) =>
        eb.or([
          eb.and({ scope: "group", ownerId: groupId }),
          ...(userId ? [eb.and({ scope: "user", ownerId: userId })] : []),
        ]),
      )
      .orderBy("updatedAt", "desc")
      .orderBy("key")
      .execute();
    const index: MemoryIndex = { group: [], user: [] };

    for (const { scope, key, summary } of entries) {
      index[scope].push({ key, summary });
    }

    return index;
  }

  public async remember(
    owner: MemoryOwner,
    entry: Pick<Memory, "key" | "summary" | "content">,
    sourceMessageId: number | null,
  ): Promise<boolean> {
    return this.#db.transaction().execute(async (db) => {
      const source = await assertActive(db, sourceMessageId);
      const current = await db
        .selectFrom("memories")
        .select(["key", "sourceMessageId", "updatedAt"])
        .where("scope", "=", owner.scope)
        .where("ownerId", "=", owner.ownerId)
        .execute();

      const existing = current.find((item) => item.key === entry.key);

      // 附件可能晚于新进展解析完成，旧消息不能覆盖较新的记忆或管理台修改。
      if (
        existing &&
        source &&
        ((existing.sourceMessageId !== null &&
          existing.sourceMessageId > source.id) ||
          (existing.sourceMessageId === null &&
            existing.updatedAt > source.receivedAt))
      ) {
        return false;
      }

      if (current.length >= 40 && !existing) {
        throw new Error("这份记忆已有 40 项，请合并相关内容或删除过时条目");
      }

      const values = {
        ...owner,
        ...entry,
        sourceMessageId,
        updatedAt: Date.now(),
      };

      await db
        .insertInto("memories")
        .values(values)
        .onConflict((conflict) =>
          conflict.columns(["scope", "ownerId", "key"]).doUpdateSet(values),
        )
        .execute();

      return true;
    });
  }

  public async forget(
    owner: MemoryOwner,
    key: string,
    sourceMessageId: number | null,
  ): Promise<boolean> {
    return this.#db.transaction().execute(async (db) => {
      const source = await assertActive(db, sourceMessageId);
      let query = db
        .deleteFrom("memories")
        .where("scope", "=", owner.scope)
        .where("ownerId", "=", owner.ownerId)
        .where("key", "=", key);

      if (source) {
        query = query.where((eb) =>
          eb.or([
            eb("sourceMessageId", "<=", source.id),
            eb.and([
              eb("sourceMessageId", "is", null),
              eb("updatedAt", "<=", source.receivedAt),
            ]),
          ]),
        );
      }

      const result = await query.executeTakeFirst();

      return result.numDeletedRows > 0n;
    });
  }
}
