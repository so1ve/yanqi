import { createError, defineEventHandler } from "h3";
import { Type } from "typebox";

import { body, groupParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot, settings } = event.context;
  const groupId = groupParam(event);

  const input = await body(
    event,
    Type.Partial(
      Type.Object({
        enabled: Type.Boolean(),
        automatic: Type.Boolean(),
        admins: Type.Array(Type.String({ pattern: "^\\d+$" }), {
          maxItems: 1000,
        }),
      }),
    ),
  );
  const saved = await settings.load();
  const { config } = saved;

  if (input.enabled !== undefined) {
    config.GROUP_IDS = input.enabled
      ? [...new Set([...config.GROUP_IDS, groupId])]
      : config.GROUP_IDS.filter((id) => id !== groupId);
  }

  if (input.admins !== undefined) {
    config.GROUP_ADMINS[groupId] = [...new Set(input.admins)].filter(
      (id) => id !== config.BOT_QQ,
    );
  }

  if (config.GROUP_IDS.length === 0 && bot.running) {
    throw createError({
      statusCode: 409,
      message: "请先暂停 AI，再停用最后一个群",
    });
  }

  await bot.store.groups.configure(groupId, input.automatic);
  await settings.save(saved);
  await bot.configure(config);

  return { ok: true };
});
