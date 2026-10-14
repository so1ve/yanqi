import { createError, defineEventHandler, getRouterParam } from "h3";

import { groupParam, integer, storeOperation } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const id = integer(getRouterParam(event, "id"));

  if (!(await storeOperation(() => bot.store.jobs.restart(groupId, id)))) {
    throw createError({
      statusCode: 409,
      message: "只能重试已完成或失败的后台任务；对话请求请在群里重新提出",
    });
  }

  bot.wake();

  return { ok: true };
});
