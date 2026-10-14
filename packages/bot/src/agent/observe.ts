import type { Config } from "../config.ts";
import { contextWithin, messageChunks } from "../recording/messages.ts";
import type { Store } from "../storage/store.ts";
import type { Job, Message } from "../types.ts";
import type { Ai } from "./ai.ts";

export async function observeRequests(
  job: Job<"observe">,
  config: Config,
  store: Store,
  ai: Ai,
): Promise<void> {
  if (!config.AUTO_REPLY) {
    return;
  }

  const { groupId, messageIds, memoryOnly = false } = job.payload;
  const conversation = await store.conversations.open(groupId);
  const messages = (
    await Promise.all(messageIds.map((id) => store.inbox.getRequest(id)))
  ).filter(
    (message): message is Message =>
      message !== null &&
      (memoryOnly || !message.command) &&
      message.id > conversation.afterMessageId,
  );

  if (messages.length === 0) {
    return;
  }

  const context = await contextWithin(
    store,
    await store.messages.conversation(
      groupId,
      20,
      messages[0]!.id - 1,
      conversation.afterMessageId,
    ),
    Math.floor(config.AI_INPUT_CHARS / 4),
  );
  const chunks = await messageChunks(
    store,
    messages,
    Math.floor(config.AI_INPUT_CHARS / 2),
  );

  for (const chunk of chunks) {
    const { requestIds, memoryIds } = await ai.decisions.selectMessages(
      groupId,
      chunk,
      context,
      memoryOnly,
    );

    await store.inbox.scheduleRequests(
      groupId,
      requestIds.map((id) => Number(id.slice(1))),
    );

    for (const id of memoryIds) {
      await store.jobs.enqueue("memory", `memory:${job.id}:${id}`, {
        groupId,
        messageId: Number(id.slice(1)),
      });
    }
  }
}
