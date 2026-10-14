import { reactionMeaning } from "../reactions/catalog.ts";
import type { Database } from "./schema.ts";

export class Reactions {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async replace(
    messageId: number,
    emojiType: string,
    emojiId: string,
    users: string[],
    botId: string,
  ) {
    const userIds = [...new Set(users)].sort();

    await this.#db.transaction().execute(async (db) => {
      // 读取期间原文可能已被 purge 清理，不能留下孤立回应。
      if (
        !(await db
          .selectFrom("messages")
          .select("id")
          .where("id", "=", messageId)
          .executeTakeFirst())
      ) {
        return;
      }

      const previous = await db
        .selectFrom("message_reactions")
        .select(["userId", "isBot"])
        .where("messageId", "=", messageId)
        .where("emojiType", "=", emojiType)
        .where("emojiId", "=", emojiId)
        .orderBy("userId")
        .execute();

      if (
        previous.length === userIds.length &&
        previous.every(
          (row, index) =>
            row.userId === userIds[index] &&
            row.isBot === Number(row.userId === botId),
        )
      ) {
        return;
      }

      await db
        .deleteFrom("message_reactions")
        .where("messageId", "=", messageId)
        .where("emojiType", "=", emojiType)
        .where("emojiId", "=", emojiId)
        .execute();
      if (userIds.length > 0) {
        await db
          .insertInto("message_reactions")
          .values(
            userIds.map((userId) => ({
              messageId,
              emojiType,
              emojiId,
              userId,
              isBot: Number(userId === botId),
            })),
          )
          .execute();
      }
      // 回应不改变原文版本；显式重新整理会重新提取当前状态。
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
