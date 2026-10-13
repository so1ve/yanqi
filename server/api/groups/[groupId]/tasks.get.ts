import { decodeJob } from "@yanqi/bot";
import { createError, defineEventHandler } from "h3";

import { groupParam, pagination, queryParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);
  const { page, limit, offset } = pagination(event);
  const state = queryParam(event, "state");
  let query = bot.database
    .selectFrom("jobs")
    .where((eb) =>
      eb(
        eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
        "=",
        groupId,
      ),
    );

  if (state) {
    if (
      state !== "done" &&
      state !== "failed" &&
      state !== "pending" &&
      state !== "running"
    ) {
      throw createError({ statusCode: 400, message: "任务状态无效" });
    }

    query = query.where("state", "=", state);
  }

  const [items, total] = await Promise.all([
    query
      .selectAll()
      .orderBy("id", "desc")
      .offset(offset)
      .limit(limit)
      .execute(),
    query
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow(),
  ]);

  return { items: items.map(decodeJob), total: total.count, page, limit };
});
