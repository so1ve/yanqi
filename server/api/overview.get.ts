import { defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const day = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
  }).format(Date.now());

  return {
    ...(await bot.store.overview(day)),
    dailyLimit: bot.config.AI_DAILY_CALL_LIMIT,
  };
});
