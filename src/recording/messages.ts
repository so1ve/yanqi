import type { Store } from "../storage/store.ts";
import type { ChatMessage, Message } from "../types.ts";
import { beijingTime } from "../utils/time.ts";

async function messageText(store: Store, message: Message): Promise<string> {
  if (message.noteId !== null) {
    const note = await store.note(message.noteId);
    const topic = await store.topic(note.topicId);

    return `[已发送纪要：${topic.title}，话题 ID：${topic.id}，第 ${note.revision} 版]\n${topic.description}`;
  }

  const attachments = (await store.assets(message.id))
    .map(
      (asset) =>
        `[${asset.kind}：${asset.state}]\n${asset.interpretation ?? asset.error ?? "尚未解析内容"}`,
    )
    .join("\n");
  const segments = message.segments.filter(
    (segment) => segment.type !== "text" && segment.type !== "reply",
  );

  return `${message.text}${segments.length > 0 ? `\n[消息片段] ${JSON.stringify(segments)}` : ""}${attachments ? `\n${attachments}` : ""}`;
}

export async function messageChunks(
  store: Store,
  messages: Message[],
  budget: number,
): Promise<ChatMessage[][]> {
  const chunks: ChatMessage[][] = [];
  let chunk: ChatMessage[] = [];
  let size = 2;

  for (const message of messages) {
    const text = `${message.recalledAt ? `[该消息已于 ${beijingTime(message.recalledAt)} 撤回；以下为留存原文]\n` : ""}${await messageText(store, message)}`;
    const quote = message.replyTo
      ? await store.quoted(message.groupId, message.replyTo)
      : null;
    const parts = Math.max(
      1,
      Math.ceil(text.length / Math.max(32, Math.floor(budget / 8))),
    );
    const length = Math.ceil(text.length / parts);

    for (let index = 0; index < parts; index++) {
      const item: ChatMessage = {
        id: `m${message.id}`,
        author: message.displayName,
        userId: message.userId,
        isBot: message.isBot,
        mentions: message.segments
          .filter((segment) => segment.type === "at")
          .map((segment) => String(segment.data.qq)),
        time: beijingTime(message.sentAt),
        text: text.slice(index * length, (index + 1) * length),
        replyTo: quote
          ? `m${quote.id}`
          : message.replyTo
            ? `qq:${message.replyTo}`
            : null,
      };
      const lengthInJson = JSON.stringify(item).length + 1;

      if (lengthInJson > budget) {
        throw new Error(`消息 m${message.id} 的元数据超过单次 AI 输入字符上限`);
      }

      if (size + lengthInJson > budget && chunk.length > 0) {
        chunks.push(chunk);
        chunk = [];
        size = 2;
      }

      chunk.push(item);
      size += lengthInJson;
    }
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }

  return chunks;
}

export async function contextWithin(
  store: Store,
  messages: Message[],
  budget: number,
): Promise<ChatMessage[]> {
  // Context may contain fragments; recording reads the selected messages in full.
  const items = (
    await messageChunks(store, messages, Math.max(1000, budget))
  ).flat();
  const result: ChatMessage[] = [];
  let size = 2;

  for (const item of items.toReversed()) {
    const length = JSON.stringify(item).length + 1;

    if (size + length > budget) {
      break;
    }

    result.unshift(item);
    size += length;
  }

  return result;
}
