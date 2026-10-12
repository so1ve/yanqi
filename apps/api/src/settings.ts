import type { Config, Yanqi } from "@yanqi/bot";
import { assertConfigured, configSchema, parseConfig } from "@yanqi/bot";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Type } from "typebox";

import type { ControlStore } from "./control.ts";
import { body } from "./http.ts";

const models = ["AI_MODEL", "AI_VISION_MODEL", "AI_AUDIO_MODEL"] as const;
const keys = ["ONEBOT_TOKEN", "DECISION_API_KEY"] as const;

export function maskedConfig(config: Config) {
  const masked = structuredClone(config);
  const secrets: Record<string, boolean> = {};

  for (const key of keys) {
    secrets[key] = Boolean(masked[key]);
    masked[key] = "";
  }

  for (const key of models) {
    const model = masked[key];

    secrets[key] = Boolean(model?.apiKey);
    if (model) {
      model.apiKey = "";
    }
  }

  return { config: masked, secrets };
}

export function registerSettings(
  app: Hono,
  bot: Yanqi,
  control: ControlStore,
): void {
  app.get("/api/settings", async (ctx) => {
    const settings = await control.settings();

    return ctx.json({
      ...maskedConfig(bot.config),
      autostart: settings.autostart,
      napcatWebUrl: settings.napcatWebUrl,
    });
  });
  app.put("/api/settings", async (ctx) => {
    const input = await body(
      ctx,
      Type.Object({
        config: configSchema,
        autostart: Type.Boolean(),
        napcatWebUrl: Type.String(),
        clearSecrets: Type.Array(Type.Enum([...models, ...keys]), {
          default: [],
        }),
      }),
    );
    let config: Config;

    try {
      config = parseConfig(input.config);
    } catch (error) {
      throw new HTTPException(400, { message: (error as Error).message });
    }

    const current = bot.config;

    config.DATA_DIR = current.DATA_DIR;
    for (const key of keys) {
      if (
        !config[key] &&
        !input.clearSecrets.includes(key) &&
        (key !== "DECISION_API_KEY" ||
          config.DECISION_URL === current.DECISION_URL)
      ) {
        config[key] = current[key];
      }
    }

    for (const key of models) {
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
      throw new HTTPException(400, {
        message: "NapCat 管理地址需要使用 http 或 https",
      });
    }

    if (bot.running || input.autostart) {
      try {
        assertConfigured(config);
      } catch (error) {
        throw new HTTPException(400, { message: (error as Error).message });
      }
    }

    await bot.configure(config);
    await control.save(config, input.autostart, input.napcatWebUrl);

    return ctx.json({
      ...maskedConfig(config),
      autostart: input.autostart,
      napcatWebUrl: input.napcatWebUrl,
    });
  });
}
