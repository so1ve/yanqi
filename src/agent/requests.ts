import type { Config } from "../config.ts";
import { contextWithin, messageChunks } from "../recording/messages.ts";
import type { Notes } from "../recording/notes.ts";
import { recordingTools } from "../recording/tools.ts";
import type { Store } from "../storage/store.ts";
import type { Ai } from "./models.ts";
import { replyTool } from "./reply.ts";

export async function handleRequest(
  messageId: number,
  config: Config,
  store: Store,
  ai: Ai,
  notes: Notes,
): Promise<void> {
  const message = await store.message(messageId);

  if (message.recalledAt !== null) {
    return;
  }

  const quote = message.replyTo
    ? await store.quoted(message.groupId, message.replyTo)
    : null;
  const request = (
    await messageChunks(store, [message], Math.floor(config.AI_INPUT_CHARS / 4))
  ).flat();
  const quoted = quote
    ? await contextWithin(store, [quote], Math.floor(config.AI_INPUT_CHARS / 6))
    : [];
  const context = await contextWithin(
    store,
    await store.conversation(message.groupId, 40, message.id - 1),
    Math.floor(config.AI_INPUT_CHARS / 4),
  );
  const memories = await store.memories.list(message.groupId, message.userId);
  const isAdmin =
    config.ADMIN_IDS.includes(message.userId) ||
    message.role === "admin" ||
    message.role === "owner";

  await ai.request(
    {
      request,
      self: {
        userId: config.BOT_QQ,
        names: ["言栖", "小栖"],
        models: {
          conversation: (config.AI_INTENT_MODEL ?? config.AI_MODEL).model,
          wording: (config.AI_REPLY_MODEL ?? config.AI_MODEL).model,
          recording: config.AI_MODEL.model,
          vision: config.AI_VISION_MODEL?.model ?? null,
        },
      },
      quoted,
      context,
      topics: (await store.topics(message.groupId, 15)).map(
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
      now: new Date(message.sentAt).toISOString(),
      timeZone: "Asia/Shanghai",
      today: new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Shanghai",
      }).format(message.sentAt),
    },
    [
      replyTool(store, message),
      ...recordingTools(store, notes, message, isAdmin, config),
      ...store.memories.tools(message),
    ],
  );
}
