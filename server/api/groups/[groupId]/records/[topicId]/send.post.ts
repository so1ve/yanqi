import { randomUUID } from "node:crypto";

import { createError, defineEventHandler, getRouterParam } from "h3";
import { Type } from "typebox";

import { body, groupParam, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const db = bot.database;
  const groupId = groupParam(event);

  if (!bot.running || !bot.online) {
    throw createError({
      statusCode: 409,
      message: "请先启动机器人并连接 NapCat",
    });
  }

  const topic = requireItem(
    (
      await db.get("topics", {
        id: getRouterParam(event, "topicId")!,
        groupId,
      })
    )[0],
  );
  const input = await body(
    event,
    Type.Object({ noteId: Type.Integer({ minimum: 1 }) }),
  );
  const note = requireItem(
    (await db.get("notes", { id: input.noteId, topicId: topic.id }))[0],
  );

  if (!bot.config.GROUP_IDS.includes(topic.groupId)) {
    throw createError({ statusCode: 409, message: "请先启用这个群" });
  }

  await db.set("topics", { id: topic.id }, { directive: "send" });
  const queued = await bot.store.deliveries.enqueue(`console:${randomUUID()}`, {
    kind: "note",
    note,
    repeat: true,
  });

  bot.wake();

  return { queued };
});
