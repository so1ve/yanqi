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
      message: "对话请求不能重试，请在群里重新提出",
    });
  }

  if (job.state === "running" || job.state === "pending") {
    throw createError({
      statusCode: 409,
      message: "任务正在排队或处理中，无需重试",
    });
  }

  await bot.store.jobs.restart(groupId, id);
  bot.wake();

  return { ok: true };
});
