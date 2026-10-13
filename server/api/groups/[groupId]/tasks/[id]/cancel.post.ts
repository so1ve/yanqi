import { $ } from "@koishijs/core";
import { createError, defineEventHandler, getRouterParam } from "h3";

import { groupParam, integer, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const id = integer(getRouterParam(event, "id"));

  await bot.database.transact(async (db) => {
    const job = requireItem(
      (await db.get("jobs", { id, "payload.groupId": groupId }))[0],
    );

    if (job.state === "running") {
      throw createError({
        statusCode: 409,
        message: "任务正在执行。需要中断时，请先停止机器人",
      });
    }

    if (job.kind === "detect" && "messageIds" in job.payload) {
      const through = Math.max(0, ...job.payload.messageIds);

      await db.set("groups", { id: groupId }, (row) => ({
        cursor: $.if($.gt(through, row.cursor), through, row.cursor),
      }));
    }

    await db.set(
      "jobs",
      { id },
      { state: "done", lastError: "管理员取消", progress: "已取消" },
    );
  });

  return { ok: true };
});
