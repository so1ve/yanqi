import assert from "node:assert/strict";

import type { Database } from "./schema.ts";

export async function linkMessages(
  db: Database,
  topicId: string,
  ids: number[],
): Promise<void> {
  const [topic] = await db.get("topics", { id: topicId });

  assert.ok(topic);
  const messages = await db.get("messages", { id: ids });
  const links = await db.get("topic_messages", { topicId, messageId: ids });
  const existing = new Set(links.map((link) => link.messageId));
  let added = 0;

  for (const id of new Set(ids)) {
    const source = messages.find((message) => message.id === id);

    assert.ok(source, `不存在的消息 m${id}`);
    if (source.groupId !== topic.groupId) {
      throw new Error("话题不能关联其他群的消息");
    }

    if (existing.has(id)) {
      continue;
    }

    await db.create("topic_messages", {
      topicId,
      messageId: id,
      generation: topic.generation + added + 1,
    });
    topic.lastSourceId = Math.max(topic.lastSourceId, id);
    topic.lastActiveAt = Math.max(topic.lastActiveAt, source.sentAt);
    added++;
  }

  if (added) {
    await db.set(
      "topics",
      { id: topicId },
      {
        generation: topic.generation + added,
        lastSourceId: topic.lastSourceId,
        lastActiveAt: topic.lastActiveAt,
      },
    );
  }
}

export async function messageChanged(
  db: Database,
  messageId: number,
): Promise<void> {
  const links = await db.get("topic_messages", { messageId });

  for (const { topicId } of links) {
    const [topic] = await db.get("topics", { id: topicId });

    assert.ok(topic);
    const generation = topic.generation + 1;

    await db.set("topic_messages", { topicId, messageId }, { generation });
    await db.set("topics", { id: topicId }, { generation });
  }
}
