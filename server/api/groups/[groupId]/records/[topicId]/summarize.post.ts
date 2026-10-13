import { defineEventHandler, getRouterParam } from "h3";
import { Type } from "typebox";

import { regenerateRecord } from "~~/server/records";
import { body, groupParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const input = await body(
    event,
    Type.Object({ focus: Type.String({ maxLength: 10_000 }) }),
  );

  return regenerateRecord(
    event.context.bot,
    groupParam(event),
    getRouterParam(event, "topicId")!,
    input.focus,
  );
});
