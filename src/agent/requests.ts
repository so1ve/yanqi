import type { Config } from "../config.ts";
import { contextWithin, messageChunks } from "../recording/messages.ts";
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
  processPending: () => void,
): Promise<void> {
  const message = await store.messages.get(messageId);

  if (message.recalledAt !== null) {
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
  const context = await contextWithin(
    store,
    await store.messages.conversation(message.groupId, 40, message.id - 1),
    Math.floor(config.AI_INPUT_CHARS / 4),
  );
  const memories = await store.memories.list(message.groupId, message.userId);
  const isAdmin =
    config.ADMIN_IDS.includes(message.userId) ||
    message.role === "admin" ||
    message.role === "owner";
  const tools = {
    store,
    message,
    config,
    notes,
    isAdmin,
    wake: processPending,
  };

  await ai.dialog.request(
    {
      request,
      self: {
        userId: config.BOT_QQ,
        names: ["言栖", "小栖"],
        models: {
          conversation: (config.AI_INTENT_MODEL ?? config.AI_MODEL).model,
          notification: (config.AI_REPLY_MODEL ?? config.AI_MODEL).model,
          recording: config.AI_MODEL.model,
          vision: config.AI_VISION_MODEL?.model ?? null,
        },
      },
      quoted,
      context,
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
      isAdmin,
      now: beijingTime(message.sentAt),
      timeZone: "Asia/Shanghai",
      today: beijingDate(message.sentAt),
    },
    [
      replyTool(tools),
      readTool(tools),
      ...recordTools(tools),
      followTool(tools),
      taskTool(tools),
      memoryTool(tools),
      ...settingsTools(tools),
    ],
  );
}
