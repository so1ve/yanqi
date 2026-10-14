import { defineEventHandler } from "h3";
import { Type } from "typebox";

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
  const failed = bot.online
    ? await bot.reactions.refresh(messages)
    : messages.length;
  const reactions = await bot.store.reactions.forMessages(
    messages.map((message) => message.id),
  );

  return {
    items: messages.map((message) => ({
      messageId: message.id,
      reactions: reactions.filter(
        (reaction) => reaction.messageId === message.id,
      ),
    })),
    error: failed
      ? `${failed} 条消息的表情回应暂时无法更新，显示已保存的回应。`
      : "",
  };
});
