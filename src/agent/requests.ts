import type { Config } from "../config.ts";
import type { Messenger } from "../onebot/messenger.ts";
import {
  contextWithin,
  conversationBefore,
  messageChunks,
} from "../recording/messages.ts";
import type { Notes } from "../recording/notes.ts";
import type { Store } from "../storage/store.ts";
import { beijingDate, beijingTime } from "../utils/time.ts";
import type { Ai } from "./ai.ts";
import { followTool } from "./tools/follow.ts";
import { memoryTool } from "./tools/memory.ts";
import { readTool } from "./tools/read.ts";
import { recordTools } from "./tools/records.ts";
import { replyTool } from "./tools/reply.ts";
import { settingsTools } from "./tools/settings.ts";
import { taskTool } from "./tools/tasks.ts";

export async function handleRequest(
  messageId: number,
  config: Config,
  store: Store,
  ai: Ai,
  notes: Notes,
  messenger: Messenger,
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
    ? await contextWithin(store, [quote], Math.floor(config.AI_INPUT_CHARS / 6))
    : [];
  const context = await conversationBefore(
    store,
    message.groupId,
    message.id,
    Math.floor(config.AI_INPUT_CHARS / 4),
  );
  const memories = await store.memories.list(message.groupId, message.userId);
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
          conversation: (config.AI_INTENT_MODEL ?? config.AI_MODEL).model,
          notification: (config.AI_REPLY_MODEL ?? config.AI_MODEL).model,
          recording: config.AI_MODEL.model,
          vision: config.AI_VISION_MODEL?.model ?? null,
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
      memory: { recent: memories.slice(0, 6), count: memories.length },
      now: beijingTime(message.sentAt),
      timeZone: "Asia/Shanghai",
      today: beijingDate(message.sentAt),
    },
    [
      replyTool(tools, messenger),
      readTool(tools),
      ...recordTools(tools),
      followTool(tools),
      taskTool(tools),
      memoryTool(tools),
      ...settingsTools(tools),
    ],
  );
}
