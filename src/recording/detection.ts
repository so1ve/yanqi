import type { Ai } from "../agent/models.ts";
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
    job.payload.messageIds.map((id) => store.message(id)),
  );
  const topics = (
    await store.automaticTopics(groupId, Date.now() - config.TOPIC_REOPEN_MS)
  )
    .slice(0, 15)
    .map(({ id, title, description }) => ({ id, title, description }));
  const context = await contextWithin(
    store,
    await store.recent(groupId, 20, messages[0]!.id - 1),
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
    const result = await ai.detect(chunk, context, topics);
    const known = new Set([...chunk, ...context].map((item) => item.id));

    for (const proposed of result.topics) {
      if (
        !proposed.id.startsWith("new:") &&
        !topics.some((topic) => topic.id === proposed.id)
      ) {
        throw new Error("AI 选择了不属于当前群的话题");
      }

      const assignment = assignments.get(proposed.id) ?? {
        ...proposed,
        messageIds: new Set<number>(),
      };

      for (const id of proposed.messageIds) {
        if (!known.has(id)) {
          throw new Error("AI 分类引用了未提供的消息");
        }

        assignment.messageIds.add(Number(id.slice(1)));
      }

      assignments.set(proposed.id, assignment);
      if (!topics.some((topic) => topic.id === proposed.id)) {
        topics.push({
          id: proposed.id,
          title: proposed.title,
          description: proposed.description,
        });
      }
    }
  }

  await store.commitDetection(
    groupId,
    messages.at(-1)!.id,
    [...assignments.values()].map((assignment) => ({
      ...assignment,
      messageIds: [...assignment.messageIds],
    })),
    Date.now(),
  );
}
