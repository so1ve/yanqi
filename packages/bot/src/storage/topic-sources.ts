import assert from "node:assert/strict";

import type { Database } from "./schema.ts";

export async function linkMessages(
  db: Database,
  topicId: string,
  ids: number[],
): Promise<void> {
  const topic = await db
    .selectFrom("topics")
    .selectAll()
    .where("id", "=", topicId)
    .executeTakeFirst();

  assert.ok(topic);
  const messages = await db
    .selectFrom("messages")
    .select(["id", "groupId", "sentAt"])
    .where("id", "in", ids)
    .execute();
  const links = await db
    .selectFrom("topic_messages")
    .select("messageId")
    .where("topicId", "=", topicId)
    .where("messageId", "in", ids)
    .execute();
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

    await db
      .insertInto("topic_messages")
      .values({
        topicId,
        messageId: id,
        generation: topic.generation + added + 1,
      })
      .execute();
    topic.lastSourceId = Math.max(topic.lastSourceId, id);
    topic.lastActiveAt = Math.max(topic.lastActiveAt, source.sentAt);
    added++;
  }

  if (added) {
    await db
      .updateTable("topics")
      .set({
        generation: topic.generation + added,
        lastSourceId: topic.lastSourceId,
        lastActiveAt: topic.lastActiveAt,
      })
      .where("id", "=", topicId)
      .execute();
  }
}

export async function messageChanged(
  db: Database,
  messageId: number,
): Promise<void> {
  const links = await db
    .selectFrom("topic_messages")
    .select("topicId")
    .where("messageId", "=", messageId)
    .execute();

  for (const { topicId } of links) {
    const topic = await db
      .updateTable("topics")
      .set((eb) => ({ generation: eb("generation", "+", 1) }))
      .where("id", "=", topicId)
      .returning("generation")
      .executeTakeFirstOrThrow();

    await db
      .updateTable("topic_messages")
      .set({ generation: topic.generation })
      .where("topicId", "=", topicId)
      .where("messageId", "=", messageId)
      .execute();
  }
}
