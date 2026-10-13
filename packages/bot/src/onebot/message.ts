import assert from "node:assert/strict";

import type { Session } from "@koishijs/core";

import type { IncomingMessage } from "../types.ts";

export function incomingMessage(session: Session): IncomingMessage {
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
