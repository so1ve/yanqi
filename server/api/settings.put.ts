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

  const current = bot.config;

  config.DATA_DIR = current.DATA_DIR;
  for (const key of secretKeys) {
    if (
      !config[key] &&
      !input.clearSecrets.includes(key) &&
      (key !== "DECISION_API_KEY" ||
        config.DECISION_URL === current.DECISION_URL)
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

  await bot.configure(config);
  await control.save(config, input.autostart, input.napcatWebUrl);

  return {
    ...maskedConfig(config),
    autostart: input.autostart,
    napcatWebUrl: input.napcatWebUrl,
  };
});
