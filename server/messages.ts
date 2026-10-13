import { Logger } from "@koishijs/core";
import type { Asset, Message, Segment, Yanqi } from "@yanqi/bot";
import { attachmentReference, forwardMessages } from "@yanqi/bot";

import { imageMimeType } from "./files";

const logger = new Logger("yanqi:web");

interface DisplaySegment extends Segment {
  assetId?: number;
  forward?: DisplayForward[];
  forwardError?: string;
}

interface DisplayForward {
  userId: string;
  displayName: string;
  sentAt: number;
  content: DisplaySegment[];
}

const displayContent = (
  content: Segment[],
  assets: Asset[],
  names: Map<string, string>,
): DisplaySegment[] =>
  content.map((segment) => {
    const ref = attachmentReference(segment);
    const asset = ref
      ? assets.find(
          (asset) =>
            asset.kind === ref.kind && asset.reference === ref.reference,
        )
      : undefined;
    let forward: DisplayForward[] | null = null;
    let data = segment.data;

    if (segment.type === "forward") {
      const raw = asset?.interpretation
        ? JSON.parse(asset.interpretation)
        : segment.data.content;

      if (raw !== undefined) {
        const messages = forwardMessages(raw);
        const senders = new Map(
          messages.map((message) => [
            message.sender.user_id,
            message.sender.nickname,
          ]),
        );

        forward = messages.map((message) => ({
          userId: message.sender.user_id,
          displayName: message.sender.nickname,
          sentAt: message.time * 1000,
          content: displayContent(
            message.content,
            assets.filter((asset) => asset.kind !== "forward"),
            senders,
          ),
        }));
      }

      data = { id: segment.data.id };
    } else if (segment.type === "at") {
      const qq = String(segment.data.qq);

      data = {
        ...data,
        name: qq === "all" ? "全体成员" : names.get(qq) || data.name || qq,
      };
    }

    return {
      type: segment.type,
      data,
      ...(asset ? { assetId: asset.id } : {}),
      ...(forward ? { forward } : {}),
      ...(segment.data.error
        ? { forwardError: String(segment.data.error) }
        : {}),
    };
  });

async function mentionNames(bot: Yanqi, groupId: string, userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, string>();
  }

  const names = await bot.store.messages.names(groupId, userIds);

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
  messages: Message[],
) {
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
    bot.store.assets.forMessages(messages.map((message) => message.id)),
    bot.store.messages.quotes(
      groupId,
      messages.flatMap((message) => (message.replyTo ? [message.replyTo] : [])),
    ),
    mentionNames(bot, groupId, userIds),
  ]);

  return messages.map((message) => {
    const messageAssets = assets.filter(
      (asset) => asset.messageId === message.id,
    );

    return {
      id: message.id,
      groupId: message.groupId,
      messageId: message.messageId,
      userId: message.userId,
      displayName: message.displayName,
      sentAt: message.sentAt,
      text: message.text,
      content: displayContent(message.content, messageAssets, names),
      isBot: message.isBot,
      addressed: message.addressed,
      recalledAt: message.recalledAt,
      replyTo: message.replyTo,
      quote:
        quotes.find((quote) => quote.messageId === message.replyTo) ?? null,
      assets: messageAssets.map(({ path, ...asset }) => ({
        ...asset,
        interpretation: asset.kind === "forward" ? null : asset.interpretation,
        downloadable: Boolean(path),
        previewable: Boolean(path && imageMimeType(path)),
      })),
    };
  });
}
