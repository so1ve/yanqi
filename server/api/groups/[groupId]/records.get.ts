import { defineEventHandler } from "h3";

import { groupParam, pagination, search } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);
  const { page, limit, offset } = pagination(event);
  const text = search(event);
  let query = bot.database.selectFrom("topics").where("groupId", "=", groupId);

  if (text) {
    query = query.where((eb) =>
      eb.or([
        eb(eb.fn<number>("contains_text", ["title", eb.val(text)]), ">", 0),
        eb(
          eb.fn<number>("contains_text", ["description", eb.val(text)]),
          ">",
          0,
        ),
        eb(eb.fn<number>("contains_text", ["focus", eb.val(text)]), ">", 0),
      ]),
    );
  }

  const [items, total] = await Promise.all([
    query
      .selectAll()
      .orderBy("lastActiveAt", "desc")
      .offset(offset)
      .limit(limit)
      .execute(),
    query
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow(),
  ]);

  return { items, total: total.count, page, limit };
});
