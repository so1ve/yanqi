import assert from "node:assert/strict";

import type { Session } from "@koishijs/core";
import { Logger } from "@koishijs/core";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { IncomingMessage } from "../types.ts";
import { failureMessage } from "../utils/errors.ts";
import { logDetail } from "../utils/logging.ts";

const logger = new Logger("yanqi:messages");

function incomingMessage(session: Session): IncomingMessage {
  const raw = session.onebot!;

  assert.ok(Array.isArray(raw.message), "请将 NapCat 消息格式设为 array");
  const role = session.event.member?.roles;

  return {
    groupId: session.guildId!,
    messageId: session.messageId!,
    userId: session.userId!,
    displayName: session.event.member?.nick || session.event.user!.name!,
    sentAt: session.timestamp,
    receivedAt: Date.now(),
    text: session
      .elements!.filter((element) => element.type === "text")
      .map((element) => element.attrs.content)
      .join(""),
    segments: raw.message,
    raw: session.event._data,
    replyTo:
      raw.message.find((segment) => segment.type === "reply")?.data.id ?? null,
    isBot: session.userId === session.selfId,
    addressed: session.elements!.some(
      (element) => element.type === "at" && element.attrs.id === session.selfId,
    ),
    role: role?.some((item) => item.id === "owner")
      ? "owner"
      : role?.some((item) => item.id === "admin")
        ? "admin"
        : "member",
  };
}

export async function saveMessage(
  session: Session,
  store: Store,
  config: Config,
) {
  try {
    const message = await store.messages.capture(incomingMessage(session));

    if (message) {
      logger[message.command ? "info" : "debug"](
        "消息 m%s 已保存：group=%s qqMessage=%s user=%s addressed=%s bot=%s chars=%s",
        message.id,
        message.groupId,
        message.messageId,
        message.userId,
        message.addressed,
        message.isBot,
        message.text.length,
      );
    } else {
      logger.debug(
        "忽略重复消息：group=%s qqMessage=%s",
        session.guildId,
        session.messageId,
      );
    }

    return message;
  } catch (error) {
    logger.warn(
      "保存群消息失败：group=%s qqMessage=%s %s",
      session.guildId,
      session.messageId,
      logDetail(failureMessage(error), config),
    );
    logger.debug("群消息异常：%s", logDetail(error, config));

    return null;
  }
}

export async function recallMessage(
  session: Session,
  store: Store,
): Promise<void> {
  await store.messages.recall(
    session.guildId!,
    session.messageId!,
    session.onebot!.time * 1000,
  );
  logger.info(
    "消息撤回：group=%s qqMessage=%s",
    session.guildId,
    session.messageId,
  );
}
