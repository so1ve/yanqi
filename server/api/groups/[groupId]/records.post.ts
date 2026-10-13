import { createError, defineEventHandler, setResponseStatus } from "h3";
import { Type } from "typebox";

import { body, groupParam, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  requireItem(await bot.store.groups.find(groupId));
  if (!bot.config.GROUP_IDS.includes(groupId)) {
    throw createError({
      statusCode: 409,
      message: "请先在“群与成员”中启用该群的“保存消息”",
    });
  }

  const input = await body(
    event,
    Type.Object({
      title: Type.String({ minLength: 1, maxLength: 300 }),
      focus: Type.String({ maxLength: 10_000, default: "" }),
      from: Type.Optional(Type.Integer({ minimum: 0 })),
      to: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
  );

  if (
    input.from !== undefined &&
    input.to !== undefined &&
    input.from > input.to
  ) {
    throw createError({ statusCode: 400, message: "开始时间不能晚于结束时间" });
  }

  const messages = await bot.store.messages.recordable(
    groupId,
    input.from ?? 0,
    input.to ?? Date.now(),
  );

  if (messages.length === 0) {
    throw createError({
      statusCode: 400,
      message: "所选时间范围内没有已保存的群成员消息",
    });
  }

  const result = await bot.store.recordings.createSummary(
    groupId,
    input.title,
    input.focus,
    messages,
  );

  bot.wake();

  setResponseStatus(event, 201);

  return result;
});
