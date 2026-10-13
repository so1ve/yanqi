import { defineEventHandler } from "h3";
import { Type } from "typebox";

import { messageDetails } from "~~/server/messages";
import { body, groupParam } from "~~/server/utils/http";

const schema = Type.Object({
  ids: Type.Array(Type.Integer({ minimum: 1 }), {
    minItems: 1,
    maxItems: 100,
    uniqueItems: true,
  }),
});

export default defineEventHandler(async (event) => {
  const groupId = groupParam(event);
  const { ids } = await body(event, schema);
  const { bot } = event.context;
  const messages = await bot.store.messages.read(groupId, ids);

  return messageDetails(bot, groupId, messages);
});
