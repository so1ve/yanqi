import { createError, defineEventHandler } from "h3";

import { groupParam, pagination, queryParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { page, limit, offset } = pagination(event);
  const state = queryParam(event, "state") || undefined;

  if (
    state !== undefined &&
    state !== "done" &&
    state !== "failed" &&
    state !== "pending" &&
    state !== "running"
  ) {
    throw createError({ statusCode: 400, message: "任务状态无效" });
  }

  const result = await event.context.bot.store.jobs.page(groupParam(event), {
    offset,
    limit,
    state,
  });

  return { ...result, page, limit };
});
