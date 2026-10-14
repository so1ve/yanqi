import { Logger } from "@koishijs/core";

import type { Ai } from "../agent/ai.ts";
import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { Job, Message, Note, Topic } from "../types.ts";
import { contextWithin } from "./messages.ts";

const logger = new Logger("yanqi:notes");

export async function publishNotes(
  config: Config,
  store: Store,
  ai: Ai,
  job: Job<"publish">,
): Promise<void> {
  const { groupId } = job.payload;
  const records: {
    topic: Topic;
    note: Note | null;
    requested: boolean;
    sources: Message[];
  }[] = [];
  let changed = false;

  for (const item of job.payload.topics) {
    const topic = await store.topics.get(item.id);
    const note = await store.notes.find(topic.id);
    const [task] = await store.jobs.forTopic(topic.id);

    if (task?.progress === "已取消" || !topic.lastSourceId) {
      continue;
    }

    if (note?.generation !== topic.generation && task?.state !== "failed") {
      await store.jobs.summarize(topic, item.requested);
      changed = true;
    }

    records.push({
      topic,
      note: note?.generation === topic.generation ? note : null,
      requested: item.requested,
      sources: await store.topics.messages(topic.id),
    });
  }

  if (changed) {
    await store.jobs.publish(
      groupId,
      job.payload.topics,
      job.payload.requestIds,
    );

    return;
  }

  if (records.length === 0) {
    await store.jobs.reportProgress(job.id, "本批纪要已取消或没有可整理内容");

    return;
  }

  const requestIds = [
    ...new Set([
      ...job.payload.requestIds,
      ...records.flatMap(({ topic }) =>
        topic.directiveMessageId === null ? [] : [topic.directiveMessageId],
      ),
    ]),
  ].sort((a, b) => b - a);
  const requests = await Promise.all(
    requestIds.map((id) => store.messages.get(id)),
  );
  const sources = [
    ...new Map(
      records
        .flatMap(({ sources }) => sources)
        .map((source) => [source.id, source]),
    ).values(),
  ]
    .filter((source) => !source.command)
    .sort((a, b) => a.id - b.id)
    .slice(-10);
  let action: "send" | "notify" | "silent" = "silent";
  let notification = "";

  if (
    records.some(
      ({ topic, note }) => topic.directive !== "send" || note === null,
    )
  ) {
    const publication = await ai.recording.choosePublication(
      records.map(({ topic, note, requested, sources }) => ({
        topic,
        revision: note?.revision ?? null,
        sources: sources.length,
        requested,
      })),
      await contextWithin(
        store,
        sources,
        Math.floor(config.AI_INPUT_CHARS / 3),
      ),
      await contextWithin(
        store,
        requests,
        Math.floor(config.AI_INPUT_CHARS / 6),
      ),
      await contextWithin(
        store,
        await store.messages.conversation(groupId, 20, Number.MAX_SAFE_INTEGER),
        Math.floor(config.AI_INPUT_CHARS / 3),
      ),
    );

    action = publication.action;
    if (action === "notify") {
      notification = publication.text.trim();
    }
  }

  // 决策期间可有新请求或原文更新。保持保存、发送要求与当前状态一致。
  for (const record of records) {
    record.topic = await store.topics.get(record.topic.id);
    if (record.note && record.topic.generation !== record.note.generation) {
      await store.jobs.summarize(record.topic, record.requested);
      changed = true;
    }
  }

  if (changed || (await store.jobs.recordingBusy(groupId))) {
    await store.jobs.publish(
      groupId,
      job.payload.topics,
      job.payload.requestIds,
    );

    return;
  }

  const saved = records.filter((record) => record.note !== null);
  const failed = records.length - saved.length;
  const outgoing = saved.flatMap(({ topic, note }) =>
    topic.directive === "send" ||
    (topic.directive === "auto" && action === "send")
      ? [{ note: note!, requestId: topic.directiveMessageId ?? undefined }]
      : [],
  );

  if (action === "notify" || (failed > 0 && outgoing.length > 0)) {
    if (failed > 0) {
      notification =
        saved.length > 0
          ? `已整理好 ${saved.length} 份纪要，另有 ${failed} 份没能完成，可以稍后重试。`
          : `这次的 ${failed} 份纪要没能整理完，可以稍后重试。`;
    } else if (!notification) {
      notification = `这次的 ${saved.length} 份纪要都整理好啦！`;
    }
  }

  if (outgoing.length > 0) {
    await store.deliveries.enqueueNotes(outgoing, notification);
  } else if (action === "notify") {
    await store.deliveries.enqueue(`publication:${job.id}`, {
      kind: "text",
      groupId,
      content: notification,
    });
  }

  await store.jobs.reportProgress(
    job.id,
    `本批已整理 ${saved.length} 份${failed ? `，${failed} 份未完成` : ""}；${outgoing.length > 0 ? "已安排合并发送" : action === "notify" ? "已安排统一通知" : "无需发送群消息"}`,
  );
  logger.info(
    "本批纪要交付：group=%s saved=%s failed=%s send=%s action=%s",
    groupId,
    saved.length,
    failed,
    outgoing.length,
    action,
  );
}
