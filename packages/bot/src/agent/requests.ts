import type { Config } from "../config.ts";
import {
  contextWithin,
  conversationBefore,
  messageChunks,
} from "../recording/messages.ts";
import type { Notes } from "../recording/notes.ts";
import type { Store } from "../storage/store.ts";
import { beijingDate, beijingTime } from "../utils/time.ts";
import type { Ai } from "./ai.ts";

export async function handleRequest(
  messageId: number,
  config: Config,
  store: Store,
  ai: Ai,
  notes: Notes,
  processPending: () => void,
): Promise<void> {
  const message = await store.messages.getRequest(messageId);

  if (!message) {
    return;
  }

  const quote = message.replyTo
    ? await store.messages.quoted(message.groupId, message.replyTo)
    : null;
  const request = (
    await messageChunks(store, [message], Math.floor(config.AI_INPUT_CHARS / 4))
  ).flat();
  const quoted = quote
    ? await contextWithin(
        store,
        [quote],
        Math.min(1500, Math.floor(config.AI_INPUT_CHARS / 6)),
      )
    : [];
  const context = await conversationBefore(
    store,
    message.groupId,
    message.id,
    Math.min(3000, Math.floor(config.AI_INPUT_CHARS / 4)),
  );
  const memory = await store.memories.context(message.groupId, message.userId);
  const tools = {
    store,
    message,
    config,
    notes,
    wake: processPending,
  };

  await ai.dialog.request(
    {
      request,
      self: {
        userId: config.BOT_QQ,
        names: ["言栖", "小栖", "栖", "bot"],
        models: {
          text: config.AI_MODEL.model,
          decision:
            config.DECISION_PROVIDER === "llm"
              ? config.AI_MODEL.model
              : config.DECISION_MODEL,
          vision: config.AI_VISION_MODEL?.model ?? null,
          audio: config.AI_AUDIO_MODEL?.model ?? null,
        },
      },
      quoted,
      context: context.messages,
      contextBeforeId: context.nextBeforeId,
      topics: (await store.topics.list(message.groupId, 15)).map(
        ({
          id,
          title,
          description,
          focus,
          state,
          mode,
          ownerId,
          directive,
          revision,
        }) => ({
          id,
          title,
          description,
          focus,
          state,
          mode,
          ownerId,
          directive,
          revision,
        }),
      ),
      memory,
      now: beijingTime(message.sentAt),
      timeZone: "Asia/Shanghai",
      today: beijingDate(message.sentAt),
    },
    tools,
  );
}
