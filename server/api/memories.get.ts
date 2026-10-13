import { memoryScope } from "@yanqi/bot";
import { createError, defineEventHandler } from "h3";
import * as Value from "typebox/value";

import { pagination, queryParam, search } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const scope = queryParam(event, "scope");
  const ownerId = queryParam(event, "ownerId");

  if (!Value.Check(memoryScope, scope)) {
    throw createError({ statusCode: 400, message: "请选择群共享或个人偏好" });
  }

  if (
    (scope === "group" && !ownerId) ||
    (ownerId !== undefined && !/^\d+$/.test(ownerId))
  ) {
    throw createError({ statusCode: 400, message: "请填写有效的群号或 QQ 号" });
  }

  const { page, limit, offset } = pagination(event);
  const text = search(event);
  let query = bot.database.selectFrom("memories").where("scope", "=", scope);

  if (ownerId) {
    query = query.where("ownerId", "=", ownerId);
  }

  if (text) {
    query = query.where((eb) =>
      eb.or([
        eb(eb.fn<number>("contains_text", ["content", eb.val(text)]), ">", 0),
        eb(eb.fn<number>("contains_text", ["key", eb.val(text)]), ">", 0),
        eb(eb.fn<number>("instr", ["ownerId", eb.val(text)]), ">", 0),
      ]),
    );
  }

  const [items, total] = await Promise.all([
    query
      .selectAll()
      .orderBy("updatedAt", "desc")
      .offset(offset)
      .limit(limit)
      .execute(),
    query
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow(),
  ]);

  return { items, total: total.count, page, limit };
});
