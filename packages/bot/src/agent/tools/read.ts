import { Type } from "typebox";

import { beijingTime } from "../../utils/time.ts";
import type { ToolContext } from "./context.ts";
import { getTopic, object, tool, topicId } from "./context.ts";

const parameters = Type.Union([
  object({ action: Type.Literal("versions"), topicId }),
  object({
    action: Type.Literal("search"),
    query: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
  }),
]);

export function readTool(context: ToolContext) {
  const { store, message } = context;

  return tool(
    context,
    "read",
    "查阅本群纪要目录，不返回全文。search 按标题、正文或编号查找文档，返回标题、简介和版本号；versions 列出指定文档的历史版本。",
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
            hint: "未找到匹配的纪要。可换用标题中的词或文档编号；这个结果不代表原始聊天中没有相关讨论。",
          };
        }
      }
    },
  );
}
