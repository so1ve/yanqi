import { defineEventHandler } from "h3";

import { groupParam, search } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);
  const text = search(event);
  let query = bot.database
    .selectFrom("messages")
    .where("groupId", "=", groupId);

  if (text) {
    query = query.where((eb) =>
      eb(eb.fn<number>("contains_text", ["text", eb.val(text)]), ">", 0),
    );
  }

  const rows = await query
    .select("id")
    .orderBy("sentAt")
    .orderBy("id")
    .execute();

  return rows.map((row) => row.id);
});
