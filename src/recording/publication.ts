import { Logger } from "koishi";

import type { Ai } from "../agent/ai.ts";
import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { Message, Note } from "../types.ts";
import { contextWithin } from "./messages.ts";

const logger = new Logger("yanqi:notes");

export async function publishNote(
  config: Config,
  store: Store,
  ai: Ai,
  note: Note,
  sources: Message[],
  requested: boolean,
): Promise<void> {
  // 整理期间仍能处理群请求，发送要求可能已经改变。
  let topic = await store.topics.get(note.topicId);
  let action: "send" | "notify" | "silent" =
    topic.directive === "send" ? "send" : "notify";
  let notification = `「${topic.title}」第 ${note.revision} 版已保存。`;

  if (topic.directive !== "send") {
    const request =
      topic.directiveMessageId === null
        ? []
        : [await store.messages.get(topic.directiveMessageId)];
    const context = await contextWithin(
      store,
      sources.filter((message) => !message.command).slice(-10),
      Math.floor(config.AI_INPUT_CHARS / 3),
    );

    const recent = await contextWithin(
      store,
      await store.messages.conversation(
        topic.groupId,
        20,
        Number.MAX_SAFE_INTEGER,
      ),
      Math.floor(config.AI_INPUT_CHARS / 3),
    );

    const publication = await ai.recording.choosePublication(
      topic,
      {
        revision: note.revision,
        sources: sources.length,
        requested,
      },
      context,
      await contextWithin(
        store,
        request,
        Math.floor(config.AI_INPUT_CHARS / 6),
      ),
      recent,
    );

    action = publication.action;
    if (publication.action === "notify") {
      notification = publication.text.trim() || notification;
    }

    topic = await store.topics.get(note.topicId);
    if (topic.directive === "send") {
      action = "send";
    } else if (topic.directive === "hold") {
      if (requested) {
        action = "notify";
      } else if (action === "send") {
        action = "silent";
      }
    }
  }

  // 新消息、撤回或结束记录可能改变原文范围；已完成的段落留在数据库中复用。
  if (topic.generation !== note.generation) {
    await store.jobs.summarize(topic, requested);
    logger.info(
      "原文已更新，继续整理后再通知：topic=%s revision=%s",
      topic.id,
      note.revision,
    );

    return;
  }

  logger.info(
    "纪要 #%s 发布决定：directive=%s action=%s",
    note.id,
    topic.directive,
    action,
  );

  if (action === "send") {
    await store.deliveries.enqueue(`auto-note:${note.id}`, {
      kind: "note",
      note,
    });
  } else if (action === "notify") {
    await store.deliveries.enqueue(`ack:${note.id}`, {
      kind: "saved",
      note,
      content: notification,
    });
  }
}
