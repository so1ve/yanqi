import { $ } from "@koishijs/core";
import { defineEventHandler } from "h3";

import { groupParam, pagination } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const { page, limit, offset } = pagination(event);
  const query = { groupId };
  const [items, total] = await Promise.all([
    bot.database.get("deliveries", query, {
      sort: { id: "desc" },
      offset,
      limit,
    }),
    bot.database.eval("deliveries", (row) => $.count(row.id), query),
  ]);

  return { items, total, page, limit };
});
