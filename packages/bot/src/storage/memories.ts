import { Type } from "typebox";

import type { Memory, MemoryContext, MemoryOwner } from "../types.ts";
import type { Database } from "./schema.ts";

export const memoryScope = Type.Enum(["group", "user"]);
export const memoryKey = Type.String({
  minLength: 1,
  maxLength: 60,
  pattern: "\\S",
});
export const memoryContent = Type.String({
  minLength: 1,
  maxLength: 500,
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
    .select("recalledAt")
    .where("id", "=", sourceMessageId)
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

  public async list({ scope, ownerId }: MemoryOwner): Promise<Memory[]> {
    return this.#db
      .selectFrom("memories")
      .selectAll()
      .where("scope", "=", scope)
      .where("ownerId", "=", ownerId)
      .orderBy("updatedAt", "desc")
      .orderBy("key")
      .execute();
  }

  public async context(
    groupId: string,
    userId?: string | null,
  ): Promise<MemoryContext> {
    const [group, user] = await Promise.all([
      this.list({ scope: "group", ownerId: groupId }),
      userId ? this.list({ scope: "user", ownerId: userId }) : [],
    ]);
    const content = ({ key, content }: Memory) => ({ key, content });

    return { group: group.map(content), user: user.map(content) };
  }

  public async remember(
    owner: MemoryOwner,
    key: string,
    content: string,
    sourceMessageId: number | null,
  ): Promise<void> {
    await this.#db.transaction().execute(async (db) => {
      await assertActive(db, sourceMessageId);
      const current = await db
        .selectFrom("memories")
        .select("key")
        .where("scope", "=", owner.scope)
        .where("ownerId", "=", owner.ownerId)
        .execute();

      if (current.length >= 40 && !current.some((item) => item.key === key)) {
        throw new Error("这份记忆已有 40 项，请合并相关内容或删除过时条目");
      }

      const values = {
        ...owner,
        key,
        content,
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
    });
  }

  public async forget(
    owner: MemoryOwner,
    key: string,
    sourceMessageId: number | null,
  ): Promise<boolean> {
    return this.#db.transaction().execute(async (db) => {
      await assertActive(db, sourceMessageId);
      const result = await db
        .deleteFrom("memories")
        .where("scope", "=", owner.scope)
        .where("ownerId", "=", owner.ownerId)
        .where("key", "=", key)
        .executeTakeFirst();

      return result.numDeletedRows > 0n;
    });
  }
}
