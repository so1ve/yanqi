import { $ } from "@koishijs/core";
import { defineEventHandler } from "h3";

import { groupParam, pagination, search } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const { page, limit, offset } = pagination(event);
  const pattern = search(event);
  const query = {
    groupId,
    ...(pattern
      ? { $or: [{ content: pattern }, { key: pattern }, { userId: pattern }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    bot.database.get("memories", query, {
      sort: { updatedAt: "desc" },
      offset,
      limit,
    }),
    bot.database.eval("memories", (row) => $.count(row.key), query),
  ]);

  return { items, total, page, limit };
});
