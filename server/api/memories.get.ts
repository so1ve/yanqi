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
  const result = await bot.store.memories.page({
    scope,
    ownerId,
    query: search(event),
    offset,
    limit,
  });

  return { ...result, page, limit };
});
