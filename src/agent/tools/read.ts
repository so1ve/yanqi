import { Type } from "typebox";

import { conversationBefore, messageChunks } from "../../recording/messages.ts";
import {
  selectSources,
  sourceId,
  sourceScope,
} from "../../recording/sources.ts";
import { taskStatus } from "../../tasks/status.ts";
import { beijingTime } from "../../utils/time.ts";
import type { ToolContext } from "./context.ts";
import { getTopic, object, tool, topicId } from "./context.ts";

const page = Type.Optional(Type.Integer({ minimum: 0 }));
const parameters = Type.Union([
  object({
    action: Type.Literal("context"),
    beforeId: Type.Optional(sourceId),
  }),
  object({ action: Type.Literal("history"), scope: sourceScope, page }),
  object({ action: Type.Literal("note"), topicId, page }),
  object({
    action: Type.Literal("search"),
    query: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
  }),
  object({ action: Type.Literal("inspect"), topicId }),
]);

export function readTool(context: ToolContext) {
  const { store, message, config } = context;
  const size = Math.floor(config.AI_INPUT_CHARS / 4);

  return tool(
    context,
    "read",
    "读取本群本地资料。context 从 beforeId 之前向前读聊天，省略则从当前请求前开始；返回的 nextBeforeId 可继续回溯，以确定讨论起止点。history 按 scope 分页读完整原文；note 分页读纪要；search 字面查标题、正文或编号；inspect 查看范围、保存版本和进度。nextPage 不为空说明还有后文。已知完整范围可直接 record，无需先读完；发送全文用 edit_record(action=send)。",
    parameters,
    async (args) => {
      switch (args.action) {
        case "context": {
          return conversationBefore(
            store,
            message.groupId,
            Math.min(
              args.beforeId ? Number(args.beforeId.slice(1)) : message.id,
              message.id,
            ),
            size,
          );
        }

        case "history": {
          const sources = await selectSources(store, message, args.scope);
          const pages = await messageChunks(store, sources, size);
          const page = args.page ?? 0;

          return {
            sourceCount: sources.length,
            page,
            nextPage: page + 1 < pages.length ? page + 1 : null,
            messages: pages[page] ?? [],
          };
        }

        case "note": {
          const topic = await getTopic(context, args.topicId);
          const note = await store.notes.latest(topic.id);

          if (!note) {
            return "这份纪要尚未保存；查看进度用 inspect，读取原文用 history。";
          }

          const page = args.page ?? 0;

          return {
            topicId: topic.id,
            revision: note.revision,
            page,
            nextPage:
              (page + 1) * size < note.markdown.length ? page + 1 : null,
            markdown: note.markdown.slice(page * size, (page + 1) * size),
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

          const pages = await messageChunks(
            store,
            await store.messages.search(message.groupId, query, message.id - 1),
            size,
          );

          return {
            records: [],
            historyMatches: pages[0] ?? [],
            hint: "这些只是字面匹配的片段。没有纪要不代表没有讨论，范围和目标明确时可直接 record。",
          };
        }

        case "inspect": {
          const topic = await getTopic(context, args.topicId);
          const sources = await store.topics.messages(topic.id);
          const note = await store.notes.latest(topic.id);
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
