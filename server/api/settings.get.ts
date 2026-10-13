import { defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  const { bot, settings } = event.context;

  return {
    ...(await settings.load()),
    dataDirectory: bot.store.directory,
  };
});
