import { configurationError } from "@yanqi/bot";
import { createError, defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;

  const error = configurationError(bot.config);

  if (error) {
    throw createError({ statusCode: 400, message: error });
  }

  await bot.start();

  return { running: true };
});
