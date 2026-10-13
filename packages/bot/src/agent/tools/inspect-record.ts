import { taskStatus } from "../../tasks/status.ts";
import { beijingTime } from "../../utils/time.ts";
import type { ToolContext } from "./context.ts";
import { getTopic, object, tool, topicId } from "./context.ts";

export function inspectRecordTool(context: ToolContext) {
  const { store, message } = context;

  return tool(
    context,
    "inspect_record",
    "查看本群纪要的原文范围、保存版本、文件位置、整理进度和发送状态，不返回全文。理解正文或比较版本交给 subagent(kind=notes)。",
    object({ topicId }),
    async (args) => {
      const topic = await getTopic(context, args.topicId);
      const sources = await store.topics.messages(topic.id);
      const note = await store.notes.find(topic.id);
      const samples =
        sources.length > 1 ? [sources[0]!, sources.at(-1)!] : sources;

      return {
        id: topic.id,
        title: topic.title,
        description: topic.description,
        focus: topic.focus,
        state: topic.state,
        currentSourceCount: sources.length,
        savedVersion: note
          ? {
              revision: note.revision,
              path: note.path,
              scannedSourceCount:
                note.sections.length > 0
                  ? new Set(
                      note.sections.flatMap((section) => section.messageIds),
                    ).size
                  : null,
              deliveries: (await store.deliveries.forNote(note.id)).map(
                (delivery) => ({
                  ...delivery,
                  createdAt: beijingTime(delivery.createdAt),
                }),
              ),
            }
          : null,
        needsUpdate: topic.generation !== topic.noteGeneration,
        tasks: await Promise.all(
          (await store.jobs.forTopic(topic.id)).map((task) =>
            taskStatus(store, message.groupId, task.id),
          ),
        ),
        samples: samples.map((source) => ({
          id: `m${source.id}`,
          time: beijingTime(source.sentAt),
          author: source.displayName,
          excerpt: source.text.slice(0, 500),
          recalledAt:
            source.recalledAt === null ? null : beijingTime(source.recalledAt),
        })),
      };
    },
  );
}
