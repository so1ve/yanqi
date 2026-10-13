import { createError, defineEventHandler, getRouterParam } from "h3";

import { groupParam, integer } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);
  const id = integer(getRouterParam(event, "id"));

  const result = await bot.store.jobs.cancel(groupId, id);

  if (result === "missing") {
    throw createError({ statusCode: 404, message: "本群没有这个任务" });
  }

  if (result === "running") {
    throw createError({
      statusCode: 409,
      message: "任务正在执行。需要中断时，请先暂停 AI",
    });
  }

  return { ok: true };
});
