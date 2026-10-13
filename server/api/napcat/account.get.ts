import { createError, defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;

  if (!bot.online) {
    throw createError({ statusCode: 503, message: "NapCat 尚未连接" });
  }

  return await bot.napcat.getLoginInfo();
});
