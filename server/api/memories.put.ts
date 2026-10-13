import { memoryContent, memoryKey, memoryOwner } from "@yanqi/bot";
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
      content: memoryContent,
    }),
  );

  await bot.store.memories.remember(
    { scope: input.scope, ownerId: input.ownerId },
    input.key.trim(),
    input.content.trim(),
    null,
  );

  return { ok: true };
});
