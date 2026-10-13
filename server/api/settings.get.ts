import { defineEventHandler } from "h3";

import { maskedConfig } from "~~/server/utils/settings";

export default defineEventHandler(async (event) => {
  const { bot, control } = event.context;

  const settings = await control.settings();

  return {
    ...maskedConfig(settings.config),
    autostart: settings.autostart,
    napcatWebUrl: settings.napcatWebUrl,
    dataDirectory: bot.store.directory,
  };
});
