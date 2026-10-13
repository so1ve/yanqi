import { defineEventHandler } from "h3";

import { messageDetails } from "~~/server/messages";
import { groupParam, pagination, search } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);
  const { page, limit, offset } = pagination(event);
  const text = search(event);
  let query = bot.database
    .selectFrom("messages")
    .where("groupId", "=", groupId);

  if (text) {
    query = query.where((eb) =>
      eb(eb.fn<number>("contains_text", ["text", eb.val(text)]), ">", 0),
    );
  }

  const [items, total] = await Promise.all([
    query
      .selectAll()
      .orderBy("id", "desc")
      .limit(limit)
      .offset(offset)
      .execute(),
    query
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow(),
  ]);

  return {
    items: await messageDetails(bot, groupId, items),
    total: total.count,
    page,
    limit,
  };
});
