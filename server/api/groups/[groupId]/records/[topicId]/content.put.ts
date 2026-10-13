import { defineEventHandler, getRouterParam } from "h3";
import { Type } from "typebox";

import { editNote } from "~~/server/records";
import { body, groupParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const input = await body(
    event,
    Type.Object({
      noteId: Type.Integer({ minimum: 1 }),
      markdown: Type.String({ minLength: 1, maxLength: 2_000_000 }),
    }),
  );

  return editNote(
    event.context.bot,
    groupParam(event),
    getRouterParam(event, "topicId")!,
    input,
  );
});
