import { createError, defineEventHandler } from "h3";

import {
  groupParam,
  pagination,
  queryParam,
  search,
} from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { page, limit, offset } = pagination(event);
  const view = queryParam(event, "view") ?? "notes";

  if (view !== "notes" && view !== "drafts") {
    throw createError({ statusCode: 400, message: "纪要列表类型无效" });
  }

  const result = await event.context.bot.store.topics.page(groupParam(event), {
    view,
    offset,
    limit,
    query: search(event),
  });

  return { ...result, page, limit };
});
