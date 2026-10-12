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
  const recording = await store.groups.automatic(groupId);
  const messages = await Promise.all(
    job.payload.messageIds.map((id) => store.messages.get(id)),
  );
  const topics = (
    await store.topics.automatic(groupId, Date.now() - config.TOPIC_REOPEN_MS)
  )
    .slice(0, 15)
    .map(({ id, title, description }) => ({ id, title, description }));
  const context = await contextWithin(
    store,
    await store.messages.conversation(groupId, 20, messages[0]!.id - 1),
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
    const observation =
      config.AUTO_REPLY || (recording && config.AI_DETECT_MODEL)
        ? await ai.recording.observe(chunk, context)
        : null;

    if (config.AUTO_REPLY && observation) {
      await store.messages.requestReplies(
        groupId,
        observation.replyIds.map((id) => Number(id.slice(1))),
      );
    }

    if (!recording) {
      continue;
    }

    const selected = observation ? new Set(observation.messageIds) : null;
    const messages = selected
      ? chunk.filter((message) => selected.has(message.id))
      : chunk;

    if (messages.length === 0) {
      continue;
    }

    const selectedContext = selected
      ? context.filter((message) => selected.has(message.id))
      : context.filter((message) => !message.isBot);
    const result = await ai.recording.detect(messages, selectedContext, topics);
    const known = new Set(
      [...messages, ...selectedContext].map((item) => item.id),
    );

    for (const proposed of result.topics) {
      if (
        !proposed.id.startsWith("new:") &&
        !topics.some((topic) => topic.id === proposed.id)
      ) {
        throw new Error("AI 选择了不属于当前群的话题");
      }

      const assignment = {
        ...proposed,
        messageIds:
          assignments.get(proposed.id)?.messageIds ?? new Set<number>(),
      };

      for (const id of proposed.messageIds) {
        if (!known.has(id)) {
          throw new Error("AI 分类引用了未提供的消息");
        }

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
    [...assignments.values()].map((assignment) => ({
      ...assignment,
      messageIds: [...assignment.messageIds],
    })),
  );
}
