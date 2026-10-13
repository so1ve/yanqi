import { defineEventHandler } from "h3";

import { groupParam, pagination, search } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { page, limit, offset } = pagination(event);
  const result = await event.context.bot.store.topics.page(groupParam(event), {
    offset,
    limit,
    query: search(event),
  });

  return { ...result, page, limit };
});
