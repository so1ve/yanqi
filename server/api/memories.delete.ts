import { memoryKey, memoryOwner } from "@yanqi/bot";
import { defineEventHandler } from "h3";
import { Type } from "typebox";

import { body } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;

  const input = await body(
    event,
    Type.Object({
      ...memoryOwner,
      key: memoryKey,
    }),
  );

  await bot.store.memories.forget(
    { scope: input.scope, ownerId: input.ownerId },
    input.key.trim(),
    null,
  );

  return { ok: true };
});
