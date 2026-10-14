import { attachmentReference } from "../onebot/content.ts";
import { imageMimeType } from "../storage/asset-files.ts";
import type { Store } from "../storage/store.ts";
import type { Asset, ChatMessage, Message } from "../types.ts";
import { beijingTime } from "../utils/time.ts";
import { contentText } from "./content.ts";

async function messageText(
  store: Store,
  message: Message,
  assets: Asset[],
): Promise<string> {
  if (message.noteId !== null) {
    const note = await store.notes.get(message.noteId);
    const topic = await store.topics.get(note.topicId);

    return `[已发送纪要：${topic.title}，话题 ID：${topic.id}，第 ${note.revision} 版]\n${topic.description}`;
  }

  return contentText(message.content, assets) || message.text;
}

export async function messageChunks(
  store: Store,
  messages: Message[],
  budget: number,
): Promise<ChatMessage[][]> {
  const reactions = await store.reactions.forMessages(
    messages.map((message) => message.id),
  );
  const chunks: ChatMessage[][] = [];
  let chunk: ChatMessage[] = [];
  let size = 2;

  for (const message of messages) {
    const assets = await store.assets.forMessage(message.id);
    const references = message.content.flatMap((segment) => {
      const ref = attachmentReference(segment);

      return ref ? [ref] : [];
    });
    const attachmentTasks = await Promise.all(
      // 卡片的 wait 会等待卡片内的附件；不在每个文本分片重复附上所有图片任务。
      assets
        .filter((asset) =>
          references.some(
            (ref) =>
              ref.kind === asset.kind && ref.reference === asset.reference,
          ),
        )
        .map(async (asset) => {
          const job = await store.jobs.forAsset(asset.id);

          return {
            assetId: asset.id,
            kind: asset.kind,
            imageRef:
              asset.path && imageMimeType(asset.path)
                ? `asset:${asset.id}`
                : null,
            taskId: job.id,
            state: job.state,
          };
        }),
    );
    const text = `${message.recalledAt ? `[该消息已于 ${beijingTime(message.recalledAt)} 撤回；以下为留存原文]\n` : ""}${await messageText(store, message, assets)}`;
    const quote = message.replyTo
      ? await store.messages.quoted(message.groupId, message.replyTo)
      : null;
    const parts = Math.max(
      1,
      Math.ceil(text.length / Math.max(32, Math.floor(budget / 8))),
    );
    const length = Math.ceil(text.length / parts);

    const items: ChatMessage[] = [];

    for (let index = 0; index < parts; index++) {
      const item: ChatMessage = {
        id: `m${message.id}`,
        author: message.displayName,
        userId: message.userId,
        isBot: message.isBot,
        mentions: message.content
          .filter((segment) => segment.type === "at")
          .map((segment) => String(segment.data.qq)),
        time: beijingTime(message.sentAt),
        text: text.slice(index * length, (index + 1) * length),
        attachmentTasks,
        replyToUserId: quote?.userId ?? null,
        replyTo: quote
          ? `m${quote.id}`
          : message.replyTo
            ? `qq:${message.replyTo}`
            : null,
      };

      items.push(item);
    }

    // 回应只附一次；数量多时沿用原消息 ID 分片，不能挤掉原文或撑爆输入。
    let last = items.at(-1)!;

    for (const reaction of reactions.filter(
      (reaction) => reaction.messageId === message.id && reaction.count > 0,
    )) {
      const { emojiId, emojiType, name, count, meaning, basis } = reaction;
      const entry = { emojiId, emojiType, name, count, meaning, basis };
      const next = [...(last.reactions ?? []), entry];

      if (JSON.stringify({ ...last, reactions: next }).length + 2 > budget) {
        last = { ...last, text: "", reactions: [entry] };
        // 最近上下文从尾部截取，正文仍放在回应分片之后。
        items.splice(-1, 0, last);
      } else {
        last.reactions = next;
      }
    }

    for (const item of items) {
      const lengthInJson = JSON.stringify(item).length + 1;

      if (lengthInJson + 1 > budget) {
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

export async function conversationBefore(
  store: Store,
  groupId: string,
  beforeId: number,
  budget: number,
  afterId = 0,
): Promise<{ messages: ChatMessage[]; nextBeforeId: string | null }> {
  const messages = await contextWithin(
    store,
    await store.messages.conversation(groupId, 40, beforeId - 1, afterId),
    budget,
  );
  const first = messages[0];
  const earlier = first
    ? await store.messages.conversation(
        groupId,
        1,
        Number(first.id.slice(1)) - 1,
        afterId,
      )
    : [];

  return { messages, nextBeforeId: earlier.length > 0 ? first!.id : null };
}
