import { defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  await event.context.avatars.clear();

  return { ok: true };
});
