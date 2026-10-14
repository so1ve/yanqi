import { Type } from "typebox";

import { beijingTime } from "../../utils/time.ts";
import type { RequestContext } from "./context.ts";
import { getTopic, object, tool, topicId } from "./context.ts";

const parameters = Type.Union([
  object({ action: Type.Literal("versions"), topicId }),
  object({
    action: Type.Literal("search"),
    query: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
  }),
]);

export function readTool(context: RequestContext) {
  const { store, message } = context;

  return tool(
    context,
    "read",
    "查阅本群纪要和讨论草稿目录，不返回全文。mode=auto 是自动留存的草稿，mode=manual 是用户要求的纪要。search 按标题、正文或编号查找文档，返回标题、简介和版本号；versions 列出指定文档的历史版本。",
    parameters,
    async (args) => {
      switch (args.action) {
        case "versions": {
          const topic = await getTopic(context, args.topicId);

          return {
            topicId: topic.id,
            title: topic.title,
            mode: topic.mode,
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
              ({ id, title, description, focus, state, mode, revision }) => ({
                id,
                title,
                description,
                focus,
                state,
                mode,
                revision,
              }),
            );
          }

          return {
            records: [],
            hint: "未找到匹配的纪要或讨论草稿。可换用标题中的词或文档编号；这个结果不代表原始聊天中没有相关讨论。",
          };
        }
      }
    },
  );
}
