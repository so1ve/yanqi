import type { Database, Message } from "@yanqi/bot";

import { imageMimeType } from "./files";

export async function messageDetails(
  db: Database,
  groupId: string,
  messages: Message[],
) {
  const [assets, quotes] = await Promise.all([
    db.get("assets", { messageId: messages.map((message) => message.id) }),
    db.get(
      "messages",
      {
        groupId,
        messageId: messages.flatMap((message) =>
          message.replyTo ? [message.replyTo] : [],
        ),
      },
      ["messageId", "displayName", "text", "recalledAt"],
    ),
  ]);

  return messages.map((message) => ({
    id: message.id,
    groupId: message.groupId,
    messageId: message.messageId,
    userId: message.userId,
    displayName: message.displayName,
    sentAt: message.sentAt,
    text: message.text,
    content: message.content,
    isBot: message.isBot,
    addressed: message.addressed,
    recalledAt: message.recalledAt,
    replyTo: message.replyTo,
    quote: quotes.find((quote) => quote.messageId === message.replyTo) ?? null,
    assets: assets
      .filter((asset) => asset.messageId === message.id)
      .map(({ path, ...asset }) => ({
        ...asset,
        downloadable: Boolean(path),
        previewable: Boolean(path && imageMimeType(path)),
      })),
  }));
}
