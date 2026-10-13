import { Logger } from "@koishijs/core";
import type { MessageRow, Segment, Yanqi } from "@yanqi/bot";
import { decodeMessage } from "@yanqi/bot";

import { imageMimeType } from "./files";

const logger = new Logger("yanqi:web");

async function mentionNames(bot: Yanqi, groupId: string, userIds: string[]) {
  const names = new Map<string, string>();

  if (userIds.length === 0) {
    return names;
  }

  const members = await bot.database
    .selectFrom("messages")
    .select(["userId", "displayName"])
    .where("id", "in", (eb) =>
      eb
        .selectFrom("messages")
        .select((eb) => eb.fn.max<number>("id").as("id"))
        .where("groupId", "=", groupId)
        .where("userId", "in", userIds)
        .groupBy("userId"),
    )
    .execute();

  for (const member of members) {
    names.set(member.userId, member.displayName);
  }

  if (bot.online) {
    try {
      const members = await bot.napcat.getGroupMemberList(groupId);

      for (const member of members) {
        const name = member.card || member.nickname;

        if (name) {
          names.set(String(member.user_id), name);
        }
      }
    } catch (error) {
      logger.warn("读取群 %s 的成员昵称失败：%s", groupId, String(error));
    }
  }

  return names;
}

export async function messageDetails(
  bot: Yanqi,
  groupId: string,
  rows: MessageRow[],
) {
  const db = bot.database;
  const messages = rows.map(decodeMessage);
  const userIds = [
    ...new Set(
      messages.flatMap((message) =>
        message.content
          .filter(
            (segment) => segment.type === "at" && segment.data.qq !== "all",
          )
          .map((segment) => String(segment.data.qq)),
      ),
    ),
  ];
  const [assets, quotes, names] = await Promise.all([
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
    mentionNames(bot, groupId, userIds),
  ]);

  return messages.map((message) => ({
    id: message.id,
    groupId: message.groupId,
    messageId: message.messageId,
    userId: message.userId,
    displayName: message.displayName,
    sentAt: message.sentAt,
    text: message.text,
    content: message.content.map((segment): Segment => {
      if (segment.type !== "at") {
        return segment;
      }

      const qq = String(segment.data.qq);

      return {
        ...segment,
        data: {
          ...segment.data,
          name:
            qq === "all"
              ? "全体成员"
              : names.get(qq) || segment.data.name || qq,
        },
      };
    }),
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
