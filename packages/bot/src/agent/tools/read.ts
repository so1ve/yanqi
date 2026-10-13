import { Type } from "typebox";

import { taskStatus } from "../../tasks/status.ts";
import { beijingTime } from "../../utils/time.ts";
import type { ToolContext } from "./context.ts";
import { getTopic, object, tool, topicId } from "./context.ts";

const parameters = Type.Union([
  object({ action: Type.Literal("versions"), topicId }),
  object({
    action: Type.Literal("search"),
    query: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
  }),
  object({ action: Type.Literal("inspect"), topicId }),
]);

export function readTool(context: ToolContext) {
  const { store, message } = context;

  return tool(
    context,
    "read",
    "查阅本群纪要概况，不返回全文。search 按标题、正文或编号查找文档；versions 列出历史版本；inspect 查看范围、保存版本和进度。查聊天、定位讨论范围或理解纪要内容交给 subagent；发送全文用 edit_record(action=send)。",
    parameters,
    async (args) => {
      switch (args.action) {
        case "versions": {
          const topic = await getTopic(context, args.topicId);

          return {
            topicId: topic.id,
            title: topic.title,
            versions: (await store.notes.versions(topic.id)).map((note) => ({
              revision: note.revision,
              createdAt: beijingTime(note.createdAt),
            })),
          };
        }

        case "search": {
          const query = args.query.trim();
          const matches = await store.topics.search(message.groupId, query);

          if (matches.length > 0) {
            return matches.map(
              ({ id, title, description, focus, state, revision }) => ({
                id,
                title,
                description,
                focus,
                state,
                revision,
              }),
            );
          }

          return {
            records: [],
            hint: "未找到匹配的纪要。查原始聊天可委派 subagent；范围和目标已明确时可直接 record。",
          };
        }

        case "inspect": {
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
                          note.sections.flatMap(
                            (section) => section.messageIds,
                          ),
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
                source.recalledAt === null
                  ? null
                  : beijingTime(source.recalledAt),
            })),
          };
        }
      }
    },
  );
}
