import { defineEventHandler } from "h3";

import { groupParam, pagination } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { page, limit, offset } = pagination(event);
  const result = await event.context.bot.store.deliveries.page(
    groupParam(event),
    { offset, limit },
  );

  return { ...result, page, limit };
});
