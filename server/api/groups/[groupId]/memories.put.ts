import { defineEventHandler } from "h3";
import { Type } from "typebox";

import { body, groupParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const input = await body(
    event,
    Type.Object({
      userId: Type.String({ pattern: "^\\d+$" }),
      key: Type.String({ minLength: 1, maxLength: 100 }),
      content: Type.String({ minLength: 1, maxLength: 4000 }),
    }),
  );

  await bot.database.transaction().execute(async (db) => {
    await db
      .insertInto("groups")
      .values({ id: groupId })
      .onConflict((conflict) => conflict.column("id").doNothing())
      .execute();
    const values = {
      ...input,
      groupId,
      sourceMessageId: null,
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

  return { ok: true };
});
