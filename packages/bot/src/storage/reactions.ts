import { reactionMeaning } from "../reactions/catalog.ts";
import type { Database } from "./schema.ts";

export class Reactions {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async replace(
    messageId: number,
    reactions: { emojiType: string; emojiId: string; users: string[] }[],
    botId: string,
  ): Promise<boolean> {
    const rows = reactions.flatMap(({ emojiType, emojiId, users }) =>
      [...new Set(users)].map((userId) => ({
        messageId,
        emojiType,
        emojiId,
        userId,
        isBot: Number(userId === botId),
      })),
    );

    return this.#db.transaction().execute(async (db) => {
      // 读取期间原文可能已被 purge 清理，不能留下孤立回应。
      if (
        !(await db
          .selectFrom("messages")
          .select("id")
          .where("id", "=", messageId)
          .executeTakeFirst())
      ) {
        return false;
      }

      const previous = await db
        .selectFrom("message_reactions")
        .selectAll()
        .where("messageId", "=", messageId)
        .execute();
      const key = (row: (typeof rows)[number]) =>
        `${row.emojiType}:${row.emojiId}:${row.userId}:${row.isBot}`;
      const saved = new Set(previous.map(key));

      if (
        previous.length === rows.length &&
        rows.every((row) => saved.has(key(row)))
      ) {
        return false;
      }

      await db
        .deleteFrom("message_reactions")
        .where("messageId", "=", messageId)
        .execute();
      if (rows.length > 0) {
        await db.insertInto("message_reactions").values(rows).execute();
      }

      // 回应不改变原文版本；显式重新整理会重新提取当前状态。
      return true;
    });
  }

  public async forMessages(ids: number[]) {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.#db
      .selectFrom("message_reactions")
      .selectAll()
      .where("messageId", "in", ids)
      .orderBy("messageId")
      .orderBy("emojiType")
      .orderBy("emojiId")
      .execute();
    const grouped = new Map<
      string,
      {
        messageId: number;
        emojiType: string;
        emojiId: string;
        count: number;
        botCount: number;
        name: string;
        meaning: string;
        basis: string;
      }
    >();

    for (const row of rows) {
      const key = `${row.messageId}:${row.emojiType}:${row.emojiId}`;
      let reaction = grouped.get(key);

      if (!reaction) {
        reaction = {
          messageId: row.messageId,
          emojiType: row.emojiType,
          emojiId: row.emojiId,
          count: 0,
          botCount: 0,
          ...reactionMeaning(row.emojiType, row.emojiId),
        };
        grouped.set(key, reaction);
      }

      if (row.isBot) {
        reaction.botCount++;
      } else {
        reaction.count++;
      }
    }

    return [...grouped.values()];
  }
}
