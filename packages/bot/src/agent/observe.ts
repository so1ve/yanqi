import type { Config } from "../config.ts";
import type { Messenger } from "../onebot/messenger.ts";
import { contextWithin, messageChunks } from "../recording/messages.ts";
import type { Store } from "../storage/store.ts";
import type { Job, Message } from "../types.ts";
import type { Ai } from "./ai.ts";

export async function observeRecordingRequests(
  job: Job<"observe">,
  config: Config,
  store: Store,
  ai: Ai,
  messenger: Messenger,
): Promise<void> {
  if (!config.AUTO_REPLY) {
    return;
  }

  const { groupId, messageIds } = job.payload;
  const messages = (
    await Promise.all(messageIds.map((id) => store.messages.getRequest(id)))
  ).filter(
    (message): message is Message => message !== null && !message.command,
  );

  if (messages.length === 0) {
    return;
  }

  const context = await contextWithin(
    store,
    await store.messages.conversation(groupId, 20, messages[0]!.id - 1),
    Math.floor(config.AI_INPUT_CHARS / 4),
  );
  const chunks = await messageChunks(
    store,
    messages,
    Math.floor(config.AI_INPUT_CHARS / 2),
  );

  for (const chunk of chunks) {
    const requestIds = await ai.decisions.recordingRequests(chunk, context);

    const requests = await store.messages.scheduleRequests(
      groupId,
      requestIds.map((id) => Number(id.slice(1))),
    );

    for (const message of requests) {
      void messenger.acknowledge(message);
    }
  }
}
