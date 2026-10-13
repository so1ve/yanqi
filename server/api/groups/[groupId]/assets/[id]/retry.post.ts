import { createError, defineEventHandler, getRouterParam } from "h3";

import { groupParam, integer, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const asset = requireItem(
    (await bot.database.get("assets", integer(getRouterParam(event, "id"))))[0],
  );

  requireItem(
    (await bot.database.get("messages", { id: asset.messageId, groupId }))[0],
  );
  const job = await bot.store.jobs.forAsset(asset.id);

  if (job.state === "running" || job.state === "pending") {
    throw createError({ statusCode: 409, message: "附件已经在处理中" });
  }

  await bot.store.jobs.restart(groupId, job.id);
  bot.wake();

  return { taskId: job.id };
});
