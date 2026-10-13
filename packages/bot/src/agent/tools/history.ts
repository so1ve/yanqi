import { Type } from "typebox";

import { conversationBefore, messageChunks } from "../../recording/messages.ts";
import {
  selectSources,
  sourceId,
  sourceScope,
} from "../../recording/sources.ts";
import type { ToolContext } from "./context.ts";
import { getTopic, object, revision, tool, topicId } from "./context.ts";

const page = Type.Optional(Type.Integer({ minimum: 0 }));
const parameters = Type.Union([
  object({
    action: Type.Literal("context"),
    beforeId: Type.Optional(sourceId),
  }),
  object({ action: Type.Literal("messages"), scope: sourceScope, page }),
  object({ action: Type.Literal("note"), topicId, revision, page }),
  object({
    action: Type.Literal("search"),
    query: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
    page,
  }),
]);

export function historyTool(context: ToolContext) {
  const { store, message, config } = context;
  const size = Math.floor(config.AI_INPUT_CHARS / 4);

  return tool(
    context,
    "history",
    "读取本群本地原文。context 向前回溯，省略 beforeId 时从当前请求前开始；messages 按 scope 分页读完整聊天；note 分页读纪要；search 字面查聊天。page 从 0 开始，nextPage 和 nextBeforeId 用于继续读取。",
    parameters,
    async (args) => {
      if (args.action === "context") {
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

      if (args.action === "note") {
        const topic = await getTopic(context, args.topicId);
        const note = await store.notes.find(topic.id, args.revision);

        if (!note) {
          throw new Error(`「${topic.title}」尚无所请求的已保存版本`);
        }

        const page = args.page ?? 0;

        return {
          topicId: topic.id,
          revision: note.revision,
          page,
          nextPage: (page + 1) * size < note.markdown.length ? page + 1 : null,
          markdown: note.markdown.slice(page * size, (page + 1) * size),
        };
      }

      const sources =
        args.action === "messages"
          ? await selectSources(store, message, args.scope)
          : await store.messages.search(
              message.groupId,
              args.query.trim(),
              message.id - 1,
            );
      const pages = await messageChunks(store, sources, size);
      const page = args.page ?? 0;

      return {
        sourceCount: sources.length,
        page,
        nextPage: page + 1 < pages.length ? page + 1 : null,
        messages: pages[page] ?? [],
      };
    },
  );
}
