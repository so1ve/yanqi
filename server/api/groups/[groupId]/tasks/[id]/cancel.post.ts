import { decodeJob } from "@yanqi/bot";
import { createError, defineEventHandler, getRouterParam } from "h3";

import { groupParam, integer, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);
  const id = integer(getRouterParam(event, "id"));

  await bot.database.transaction().execute(async (db) => {
    const job = decodeJob(
      requireItem(
        await db
          .selectFrom("jobs")
          .selectAll()
          .where("id", "=", id)
          .where((eb) =>
            eb(
              eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
              "=",
              groupId,
            ),
          )
          .executeTakeFirst(),
      ),
    );

    if (job.state === "running") {
      throw createError({
        statusCode: 409,
        message: "任务正在执行。需要中断时，请先暂停 AI",
      });
    }

    if (job.kind === "detect" && "messageIds" in job.payload) {
      const through = Math.max(0, ...job.payload.messageIds);

      await db
        .updateTable("groups")
        .set((eb) => ({
          cursor: eb.fn<number>("max", ["cursor", eb.val(through)]),
        }))
        .where("id", "=", groupId)
        .execute();
    }

    await db
      .updateTable("jobs")
      .set({ state: "done", lastError: "管理员取消", progress: "已取消" })
      .where("id", "=", id)
      .execute();
  });

  return { ok: true };
});
