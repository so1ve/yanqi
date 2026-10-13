import { $ } from "@koishijs/core";
import { defineEventHandler } from "h3";

import { groupParam, pagination, search } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const { page, limit, offset } = pagination(event);
  const pattern = search(event);

  const query = { groupId, ...(pattern ? { text: pattern } : {}) };
  const [items, total] = await Promise.all([
    bot.database.get("messages", query, {
      sort: { id: "desc" },
      limit,
      offset,
      fields: [
        "id",
        "groupId",
        "messageId",
        "userId",
        "displayName",
        "sentAt",
        "text",
        "isBot",
        "addressed",
        "recalledAt",
        "replyTo",
      ],
    }),
    bot.database.eval("messages", (row) => $.count(row.id), query),
  ]);
  const attachments = await bot.database.get("assets", {
    messageId: items.map((item) => item.id),
  });

  return {
    items: items.map((item) => ({
      ...item,
      assets: attachments
        .filter((asset) => asset.messageId === item.id)
        .map(({ path, reference, ...asset }) => ({
          ...asset,
          downloadable: Boolean(path),
          reference,
        })),
    })),
    total,
    page,
    limit,
  };
});
