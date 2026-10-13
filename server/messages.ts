import type { Database, MessageRow } from "@yanqi/bot";
import { decodeMessage } from "@yanqi/bot";

import { imageMimeType } from "./files";

export async function messageDetails(
  db: Database,
  groupId: string,
  rows: MessageRow[],
) {
  const messages = rows.map(decodeMessage);
  const [assets, quotes] = await Promise.all([
    db
      .selectFrom("assets")
      .selectAll()
      .where(
        "messageId",
        "in",
        messages.map((message) => message.id),
      )
      .execute(),
    db
      .selectFrom("messages")
      .select(["messageId", "displayName", "text", "recalledAt"])
      .where("groupId", "=", groupId)
      .where(
        "messageId",
        "in",
        messages.flatMap((message) =>
          message.replyTo ? [message.replyTo] : [],
        ),
      )
      .execute(),
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
