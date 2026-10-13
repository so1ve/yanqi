import { createError, defineEventHandler, setResponseStatus } from "h3";
import { Type } from "typebox";

import { body, groupParam, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const db = bot.database;
  const groupId = groupParam(event);

  requireItem((await db.get("groups", { id: groupId }))[0]);
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

  const messages = await db.get(
    "messages",
    {
      groupId,
      isBot: false,
      command: false,
      sentAt: { $gte: input.from ?? 0, $lte: input.to ?? Date.now() },
    },
    { fields: ["id"], sort: { id: "asc" } },
  );

  if (messages.length === 0) {
    throw createError({
      statusCode: 400,
      message: "所选时间范围内没有已保存的群成员消息",
    });
  }

  const topic = await bot.store.recordings.createForGroup(
    groupId,
    input.title,
    input.focus,
    messages.map((message) => message.id),
  );
  const taskId = await bot.store.jobs.enqueue(
    "summarize",
    `summarize:${topic.id}:${topic.generation}`,
    { groupId, topicId: topic.id, requested: true, publish: false },
  );

  bot.wake();

  setResponseStatus(event, 201);

  return { topic, taskId };
});
