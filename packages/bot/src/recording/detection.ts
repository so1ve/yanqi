import type { Ai } from "../agent/ai.ts";
import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { Job } from "../types.ts";
import { contextWithin, messageChunks } from "./messages.ts";

export async function detectTopics(
  job: Job<"detect">,
  config: Config,
  store: Store,
  ai: Ai,
): Promise<void> {
  const groupId = job.payload.groupId;
  const messages = await Promise.all(
    job.payload.messageIds.map((id) => store.messages.get(id)),
  );
  const topics = (
    await store.topics.automatic(groupId, Date.now() - config.TOPIC_REOPEN_MS)
  )
    .slice(0, 15)
    .map(({ id, title, description }) => ({ id, title, description }));
  const recent = (
    await store.messages.conversation(groupId, 20, messages[0]!.id - 1)
  ).filter((message) => !message.historical);
  const discussionIds = new Set(
    [...messages, ...recent]
      .filter(
        (message) =>
          !message.isBot &&
          (message.text.trim() ||
            message.content.some((segment) =>
              ["audio", "forward", "record"].includes(segment.type),
            )),
      )
      .map((message) => message.id),
  );
  const context = await contextWithin(
    store,
    recent,
    Math.floor(config.AI_INPUT_CHARS / 6),
  );
  const chunks = await messageChunks(
    store,
    messages,
    Math.floor(config.AI_INPUT_CHARS / 3),
  );
  const assignments = new Map<
    string,
    {
      id: string;
      title: string;
      description: string;
      messageIds: Set<number>;
    }
  >();

  for (const chunk of chunks) {
    const selectedContext = context.filter((message) => !message.isBot);
    const result = await ai.recording.detect(chunk, selectedContext, topics);

    // AI 边界的 Schema 已约束消息和话题 ID，错误会在原会话中反馈并纠正。
    for (const proposed of result.topics) {
      const assignment = {
        ...proposed,
        messageIds:
          assignments.get(proposed.id)?.messageIds ?? new Set<number>(),
      };

      for (const id of proposed.messageIds) {
        assignment.messageIds.add(Number(id.slice(1)));
      }

      assignments.set(proposed.id, assignment);
      const topic = topics.find((topic) => topic.id === proposed.id);

      if (topic) {
        topic.title = proposed.title;
        topic.description = proposed.description;
      } else {
        topics.push({
          id: proposed.id,
          title: proposed.title,
          description: proposed.description,
        });
      }
    }
  }

  await store.topics.commitDetection(
    groupId,
    messages.at(-1)!.id,
    [...assignments.values()]
      .filter(
        (assignment) =>
          !assignment.id.startsWith("new:") ||
          [...assignment.messageIds].some((id) => discussionIds.has(id)),
      )
      .map((assignment) => ({
        ...assignment,
        messageIds: [...assignment.messageIds],
      })),
  );
}
