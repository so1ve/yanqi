import { defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  await event.context.bot.stop();

  return { running: false };
});
