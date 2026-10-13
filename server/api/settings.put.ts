import type { Config } from "@yanqi/bot";
import { assertConfigured, configSchema, parseConfig } from "@yanqi/bot";
import { createError, defineEventHandler } from "h3";
import { Type } from "typebox";

import { body } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot, control } = event.context;

  const input = await body(
    event,
    Type.Object({
      config: configSchema,
      autostart: Type.Boolean(),
      napcatWebUrl: Type.String(),
    }),
  );
  let config: Config;

  try {
    config = parseConfig(input.config);
  } catch (error) {
    throw createError({ statusCode: 400, message: (error as Error).message });
  }

  const { config: current } = await control.settings();

  config.GROUP_IDS = current.GROUP_IDS;
  config.GROUP_ADMINS = current.GROUP_ADMINS;

  if (
    input.napcatWebUrl &&
    (!URL.canParse(input.napcatWebUrl) ||
      !["http:", "https:"].includes(new URL(input.napcatWebUrl).protocol))
  ) {
    throw createError({
      statusCode: 400,
      message: "请填写有效的 NapCat 管理页地址，使用 http:// 或 https://",
    });
  }

  if (bot.running || input.autostart) {
    try {
      assertConfigured(config);
    } catch (error) {
      throw createError({ statusCode: 400, message: (error as Error).message });
    }
  }

  await control.save(config, input.autostart, input.napcatWebUrl);
  try {
    await bot.configure(config);
  } catch (error) {
    throw createError({
      statusCode: 500,
      message: `设置已保存，但应用失败：${(error as Error).message}`,
    });
  }

  return {
    config,
    autostart: input.autostart,
    napcatWebUrl: input.napcatWebUrl,
    dataDirectory: bot.store.directory,
  };
});
