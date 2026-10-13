import { $ } from "@koishijs/core";
import { defineEventHandler } from "h3";

import { messageDetails } from "~~/server/messages";
import { groupParam, pagination, search } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const { page, limit, offset } = pagination(event);
  const pattern = search(event);

  const query = { groupId, ...(pattern ? { text: pattern } : {}) };
  const [items, total] = await Promise.all([
    bot.database.get("messages", query, {
      sort: { id: "desc" },
      limit,
      offset,
    }),
    bot.database.eval("messages", (row) => $.count(row.id), query),
  ]);

  return {
    items: await messageDetails(bot.database, groupId, items),
    total,
    page,
    limit,
  };
});
