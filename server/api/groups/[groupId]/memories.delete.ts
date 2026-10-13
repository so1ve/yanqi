import { defineEventHandler } from "h3";
import { Type } from "typebox";

import { body, groupParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const input = await body(
    event,
    Type.Object({
      userId: Type.String({ pattern: "^\\d+$" }),
      key: Type.String({ minLength: 1, maxLength: 100 }),
    }),
  );

  await bot.database.remove("memories", {
    ...input,
    groupId,
  });

  return { ok: true };
});
