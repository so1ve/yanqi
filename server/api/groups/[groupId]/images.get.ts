import { defineEventHandler } from "h3";

import { groupParam, integer, queryParam, search } from "~~/server/utils/http";

export default defineEventHandler((event) => {
  const before = queryParam(event, "before");

  return event.context.bot.store.assets.listImages(
    groupParam(event),
    search(event),
    before === undefined ? undefined : integer(before),
  );
});
