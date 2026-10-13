import { createError, defineEventHandler, getRouterParam } from "h3";

import { groupParam, integer, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const id = integer(getRouterParam(event, "id"));
  const delivery = requireItem(await bot.store.deliveries.find(groupId, id));

  if (bot.running) {
    throw createError({
      statusCode: 409,
      message: "请先暂停 AI，避免取消时消息已经发出",
    });
  }

  if (delivery.state !== "pending") {
    throw createError({ statusCode: 409, message: "只能取消尚未发送的消息" });
  }

  await bot.store.deliveries.cancel(id);

  return { ok: true };
});
