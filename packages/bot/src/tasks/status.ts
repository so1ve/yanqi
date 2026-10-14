import type { Store } from "../storage/store.ts";
import { beijingTime } from "../utils/time.ts";

export async function taskStatus(store: Store, groupId: string, id: number) {
  const job = await store.jobs.get(groupId, id);
  const { payload } = job;
  const asset =
    "assetId" in payload ? await store.assets.get(payload.assetId) : null;
  const topic =
    "topicId" in payload ? await store.topics.get(payload.topicId) : null;
  const note = topic ? await store.notes.find(topic.id) : null;
  const attachments = asset
    ? await Promise.all(
        (await store.assets.inForward(asset)).map(async (child) => {
          const task = await store.jobs.forAsset(child.id);

          return {
            assetId: child.id,
            kind: child.kind,
            taskId: task.id,
            state: task.state,
            error: child.error,
          };
        }),
      )
    : [];

  return {
    id: job.id,
    kind: job.kind,
    description: asset
      ? `解析消息 m${asset.messageId} 的附件 #${asset.id}（${asset.kind}）`
      : topic
        ? `整理「${topic.title}」`
        : job.kind === "publish"
          ? "等待本批纪要完成后统一交付"
          : job.kind === "detect"
            ? "识别讨论话题"
            : job.kind === "observe"
              ? "识别请求"
              : job.kind === "memory"
                ? "更新记忆"
                : "处理对话请求（与后台整理和发送分别执行）",
    state: job.state,
    attempts: job.attempts,
    progress: job.progress,
    context: topic
      ? {
          title: topic.title,
          mode: topic.mode,
          description: topic.description,
          focus: topic.focus,
        }
      : null,
    error: job.lastError,
    retryAt:
      job.state === "pending" && job.lastError
        ? beijingTime(job.runAfter)
        : null,
    source: payload,
    savedVersion:
      topic?.mode === "manual" && note
        ? {
            noteId: note.id,
            revision: note.revision,
            path: note.path,
            needsUpdate: note.generation !== topic.generation,
            deliveries: await store.deliveries.forNote(note.id),
          }
        : null,
    ...("messageId" in payload
      ? { deliveries: await store.deliveries.forRequest(payload.messageId) }
      : {}),
    result: asset
      ? {
          assetId: asset.id,
          messageId: `m${asset.messageId}`,
          fileSaved: asset.path !== null,
          interpretation:
            asset.kind === "forward" ? null : asset.interpretation,
          ...(asset.kind === "forward"
            ? {
                attachments: {
                  total: attachments.length,
                  completed: attachments.filter((item) => item.state === "done")
                    .length,
                  pending: attachments.filter(
                    (item) =>
                      item.state === "pending" || item.state === "running",
                  ).length,
                  failed: attachments.filter((item) => item.error),
                },
                content:
                  "转发原文及图片引用可通过上下文查询工具读取。wait 会等待卡片内的附件解析。",
              }
            : {}),
          error: asset.error,
          note:
            job.state === "done" && !asset.interpretation
              ? "任务已结束，但没有识别结果。图片或语音需要配置对应模型才能解析，文件保存状态见 fileSaved。"
              : null,
        }
      : null,
  };
}
