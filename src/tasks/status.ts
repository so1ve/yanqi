import type { Store } from "../storage/store.ts";
import { beijingTime } from "../utils/time.ts";

export async function taskStatus(store: Store, groupId: string, id: number) {
  const job = await store.jobs.get(groupId, id);
  const { payload } = job;
  const asset =
    "assetId" in payload ? await store.assets.get(payload.assetId) : null;
  const topic =
    "topicId" in payload ? await store.topics.get(payload.topicId) : null;
  const note = topic ? await store.notes.latest(topic.id) : null;

  return {
    id: job.id,
    kind: job.kind,
    description: asset
      ? `消息 m${asset.messageId} 的${asset.kind}附件 #${asset.id}`
      : topic
        ? `整理「${topic.title}」`
        : job.kind === "detect"
          ? "自动识别群里的讨论话题"
          : job.kind === "observe"
            ? "判断最近群聊是否需要接话"
            : "处理群成员的对话请求",
    state: job.state,
    attempts: job.attempts,
    progress: job.progress,
    error: job.lastError,
    retryAt:
      job.state === "pending" && job.lastError
        ? beijingTime(job.runAfter)
        : null,
    source: payload,
    result: asset
      ? {
          assetId: asset.id,
          messageId: `m${asset.messageId}`,
          fileSaved: asset.path !== null,
          interpretation: asset.interpretation,
          error: asset.error,
          note:
            job.state === "done" && !asset.interpretation
              ? "文件已保存，但没有内容识别结果；图片或语音需配置对应模型才能解析。"
              : null,
        }
      : note
        ? { noteId: note.id, revision: note.revision, path: note.path }
        : null,
  };
}
