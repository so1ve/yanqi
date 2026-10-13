import { $ } from "@koishijs/core";
import { createError, defineEventHandler } from "h3";

import { groupParam, pagination, queryParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const { page, limit, offset } = pagination(event);
  const state = queryParam(event, "state");

  if (state && !["done", "failed", "pending", "running"].includes(state)) {
    throw createError({ statusCode: 400, message: "任务状态无效" });
  }

  const query = {
    "payload.groupId": groupId,
    ...(state
      ? { state: state as "pending" | "running" | "done" | "failed" }
      : {}),
  };
  const [items, total] = await Promise.all([
    bot.database.get("jobs", query, { sort: { id: "desc" }, offset, limit }),
    bot.database.eval("jobs", (row) => $.count(row.id), query),
  ]);

  return { items, total, page, limit };
});
