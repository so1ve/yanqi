import { defineEventHandler } from "h3";

import { groupParam, search } from "~~/server/utils/http";

export default defineEventHandler((event) =>
  event.context.bot.store.messages.ids(groupParam(event), search(event)),
);
