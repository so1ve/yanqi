import { createError, defineEventHandler, getRouterParam } from "h3";
import { Type } from "typebox";

import { body, groupParam, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const db = bot.database;
  const groupId = groupParam(event);

  if (!bot.config.GROUP_IDS.includes(groupId)) {
    throw createError({
      statusCode: 409,
      message: "请先在“群与成员”中启用该群的“保存消息”",
    });
  }

  const topic = await db.transact(async (tx) => {
    const topic = requireItem(
      (
        await tx.get("topics", {
          id: getRouterParam(event, "topicId")!,
          groupId,
        })
      )[0],
    );
    const busy = await tx.get("jobs", {
      "kind": "summarize",
      "payload.topicId": topic.id,
      "$or": [{ state: "pending" }, { state: "running" }],
    });

    if (busy.length > 0) {
      throw createError({
        statusCode: 409,
        message: "这篇纪要正在排队或整理中",
      });
    }

    const input = await body(
      event,
      Type.Object({ focus: Type.String({ maxLength: 10_000 }) }),
    );
    const generation = topic.generation + 1;

    await tx.set(
      "topics",
      { id: topic.id },
      { generation, focus: input.focus },
    );
    await tx.set("topic_messages", { topicId: topic.id }, { generation });

    return { ...topic, generation };
  });
  const taskId = await bot.store.jobs.enqueue(
    "summarize",
    `summarize:${topic.id}:${topic.generation}`,
    {
      groupId: topic.groupId,
      topicId: topic.id,
      requested: true,
      publish: false,
    },
  );

  bot.wake();

  return { taskId };
});
