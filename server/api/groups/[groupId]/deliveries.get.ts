import { defineEventHandler } from "h3";

import { groupParam, pagination } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);
  const { page, limit, offset } = pagination(event);
  const query = bot.database
    .selectFrom("deliveries")
    .where("groupId", "=", groupId);
  const [items, total] = await Promise.all([
    query
      .selectAll()
      .orderBy("id", "desc")
      .offset(offset)
      .limit(limit)
      .execute(),
    query
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow(),
  ]);

  return { items, total: total.count, page, limit };
});
