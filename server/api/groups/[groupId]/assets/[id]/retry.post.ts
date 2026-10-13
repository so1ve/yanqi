import { createError, defineEventHandler, getRouterParam } from "h3";

import { groupParam, integer, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const asset = requireItem(
    await bot.database
      .selectFrom("assets")
      .selectAll()
      .where("id", "=", integer(getRouterParam(event, "id")))
      .executeTakeFirst(),
  );

  requireItem(
    await bot.database
      .selectFrom("messages")
      .select("id")
      .where("id", "=", asset.messageId)
      .where("groupId", "=", groupId)
      .executeTakeFirst(),
  );
  const job = await bot.store.jobs.forAsset(asset.id);

  if (!(await bot.store.jobs.restart(groupId, job.id))) {
    throw createError({ statusCode: 409, message: "附件已经在处理中" });
  }

  bot.wake();

  return { taskId: job.id };
});
