import { rm } from "node:fs/promises";
import { join } from "node:path";

import { createError, defineEventHandler, getRouterParam } from "h3";

import { groupParam, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const db = bot.database;
  const groupId = groupParam(event);

  await db.transact(async (tx) => {
    const topic = requireItem(
      (
        await tx.get("topics", {
          id: getRouterParam(event, "topicId")!,
          groupId,
        })
      )[0],
    );
    const busy = await tx.get("jobs", {
      "payload.topicId": topic.id,
      "state": "running",
    });

    if (busy.length > 0 || bot.running) {
      throw createError({
        statusCode: 409,
        message: "请先停止机器人，再删除纪要",
      });
    }

    await rm(
      join(bot.config.DATA_DIR, "groups", topic.groupId, "topics", topic.id),
      { recursive: true, force: true },
    );
    await tx.remove("deliveries", { topicId: topic.id });
    await tx.remove("jobs", { "payload.topicId": topic.id });
    await tx.remove("notes", { topicId: topic.id });
    await tx.remove("topic_messages", { topicId: topic.id });
    await tx.remove("topics", { id: topic.id });
  });

  return { ok: true };
});
