import { defineEventHandler, getRouterParam } from "h3";

import { deleteRecord } from "~~/server/records";
import { groupParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  await deleteRecord(
    event.context.bot,
    groupParam(event),
    getRouterParam(event, "topicId")!,
  );

  return { ok: true };
});
