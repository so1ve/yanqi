import { randomUUID } from "node:crypto";

import { decodeNote } from "@yanqi/bot";
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
      message: "请先启动 AI 处理并连接 NapCat",
    });
  }

  const topic = requireItem(
    await db
      .selectFrom("topics")
      .selectAll()
      .where("id", "=", getRouterParam(event, "topicId")!)
      .where("groupId", "=", groupId)
      .executeTakeFirst(),
  );
  const input = await body(
    event,
    Type.Object({ noteId: Type.Integer({ minimum: 1 }) }),
  );
  const note = decodeNote(
    requireItem(
      await db
        .selectFrom("notes")
        .selectAll()
        .where("id", "=", input.noteId)
        .where("topicId", "=", topic.id)
        .executeTakeFirst(),
    ),
  );

  if (!bot.config.GROUP_IDS.includes(topic.groupId)) {
    throw createError({ statusCode: 409, message: "请先启用这个群" });
  }

  await db
    .updateTable("topics")
    .set({ directive: "send" })
    .where("id", "=", topic.id)
    .execute();
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
