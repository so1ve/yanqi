import { assertConfigured } from "@yanqi/bot";
import { createError, defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;

  try {
    assertConfigured(bot.config);
  } catch (error) {
    throw createError({ statusCode: 400, message: (error as Error).message });
  }

  await bot.start();

  return { running: true };
});
