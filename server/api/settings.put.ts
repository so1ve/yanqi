import type { Config } from "@yanqi/bot";
import { assertConfigured, configSchema, parseConfig } from "@yanqi/bot";
import { createError, defineEventHandler } from "h3";
import { Type } from "typebox";

import { body } from "~~/server/utils/http";
import { maskedConfig, modelKeys, secretKeys } from "~~/server/utils/settings";

export default defineEventHandler(async (event) => {
  const { bot, control } = event.context;

  const input = await body(
    event,
    Type.Object({
      config: configSchema,
      autostart: Type.Boolean(),
      napcatWebUrl: Type.String(),
      clearSecrets: Type.Array(Type.Enum([...modelKeys, ...secretKeys]), {
        default: [],
      }),
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
  for (const key of secretKeys) {
    if (
      !config[key] &&
      !input.clearSecrets.includes(key) &&
      (key === "ONEBOT_TOKEN"
        ? config.ONEBOT_URL === current.ONEBOT_URL
        : config.DECISION_URL === current.DECISION_URL)
    ) {
      config[key] = current[key];
    }
  }

  for (const key of modelKeys) {
    const model = config[key];
    const old = current[key];

    if (
      model &&
      old &&
      !model.apiKey &&
      !input.clearSecrets.includes(key) &&
      model.baseURL === old.baseURL
    ) {
      model.apiKey = old.apiKey;
    }
  }

  if (
    input.napcatWebUrl &&
    (!URL.canParse(input.napcatWebUrl) ||
      !["http:", "https:"].includes(new URL(input.napcatWebUrl).protocol))
  ) {
    throw createError({
      statusCode: 400,
      message: "NapCat 管理地址需要使用 http 或 https",
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
    ...maskedConfig(config),
    autostart: input.autostart,
    napcatWebUrl: input.napcatWebUrl,
    dataDirectory: bot.store.directory,
  };
});
