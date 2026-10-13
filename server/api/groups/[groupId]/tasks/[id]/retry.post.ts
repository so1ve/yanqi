import { createError, defineEventHandler, getRouterParam } from "h3";

import { groupParam, integer } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const id = integer(getRouterParam(event, "id"));
  const job = await bot.store.jobs.get(groupId, id);

  if (job.kind === "intent" || job.kind === "observe") {
    throw createError({
      statusCode: 409,
      message: "旧对话不能重放，请在群里重新发起请求",
    });
  }

  if (job.state === "running" || job.state === "pending") {
    throw createError({ statusCode: 409, message: "任务已经在队列中" });
  }

  await bot.store.jobs.restart(groupId, id);
  bot.wake();

  return { ok: true };
});
