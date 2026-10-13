import { createError, defineEventHandler } from "h3";

import { groupParam, queryParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const day =
    queryParam(event, "day") ??
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
      Date.now(),
    );

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw createError({ statusCode: 400, message: "日期需要 YYYY-MM-DD 格式" });
  }

  return await bot.store.usage.summary(groupId, day);
});
