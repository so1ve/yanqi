import { defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  const { bot, control } = event.context;

  const settings = await control.settings();

  return {
    ...settings,
    dataDirectory: bot.store.directory,
  };
});
