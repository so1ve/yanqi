import { randomUUID } from "node:crypto";

import { createError, defineEventHandler, getRouterParam } from "h3";
import { Type } from "typebox";

import { body, groupParam, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  if (!bot.running || !bot.online) {
    throw createError({
      statusCode: 409,
      message: "请先启动 AI 处理并连接 NapCat",
    });
  }

  const topic = requireItem(
    await bot.store.topics.find(groupId, getRouterParam(event, "topicId")!),
  );
  const input = await body(
    event,
    Type.Object({ noteId: Type.Integer({ minimum: 1 }) }),
  );
  const note = requireItem(
    await bot.store.notes.version(groupId, topic.id, input.noteId),
  );

  if (!bot.config.GROUP_IDS.includes(topic.groupId)) {
    throw createError({ statusCode: 409, message: "请先启用这个群" });
  }

  await bot.store.topics.setDirective(topic.id, "send");
  const delivery = await bot.store.deliveries.enqueue(
    `console:${randomUUID()}`,
    {
      kind: "note",
      note,
      repeat: true,
    },
  );

  bot.wake();

  return { queued: delivery.state === "pending" };
});
