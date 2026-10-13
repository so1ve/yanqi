import { $ } from "@koishijs/core";
import { defineEventHandler } from "h3";

import { groupParam, pagination, search } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const db = bot.database;
  const groupId = groupParam(event);

  const { page, limit, offset } = pagination(event);
  const pattern = search(event);
  const query = {
    groupId,
    ...(pattern
      ? {
          $or: [
            { title: pattern },
            { description: pattern },
            { focus: pattern },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.get("topics", query, {
      sort: { lastActiveAt: "desc" },
      offset,
      limit,
    }),
    db.eval("topics", (row) => $.count(row.id), query),
  ]);

  return { items, total, page, limit };
});
