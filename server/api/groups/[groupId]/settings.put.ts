import { createError, defineEventHandler } from "h3";
import { Type } from "typebox";

import { body, groupParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot, control } = event.context;
  const groupId = groupParam(event);

  const input = await body(
    event,
    Type.Object({
      enabled: Type.Boolean(),
      automatic: Type.Boolean(),
      admins: Type.Array(Type.String({ pattern: "^\\d+$" }), {
        maxItems: 1000,
      }),
    }),
  );
  const config = bot.config;

  config.GROUP_IDS = input.enabled
    ? [...new Set([...config.GROUP_IDS, groupId])]
    : config.GROUP_IDS.filter((id) => id !== groupId);
  config.GROUP_ADMINS[groupId] = [...new Set(input.admins)];
  if (config.GROUP_IDS.length === 0 && bot.running) {
    throw createError({
      statusCode: 409,
      message: "请先停止机器人，再停用最后一个群",
    });
  }

  await bot.database.upsert("groups", [
    { id: groupId, aiEnabled: input.automatic },
  ]);
  await bot.configure(config);
  const settings = await control.settings();

  await control.save(config, settings.autostart, settings.napcatWebUrl);

  return { ok: true };
});
