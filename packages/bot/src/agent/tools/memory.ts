import { Type } from "typebox";

import type { ToolContext } from "./context.ts";
import { object, tool } from "./context.ts";

const key = Type.String({ minLength: 1, maxLength: 60, pattern: "\\S" });
const parameters = Type.Union([
  object({
    action: Type.Literal("recall"),
    query: Type.Optional(Type.String({ maxLength: 100 })),
  }),
  object({
    action: Type.Literal("remember"),
    key,
    content: Type.String({ minLength: 1, maxLength: 500, pattern: "\\S" }),
  }),
  object({ action: Type.Literal("forget"), key }),
]);

export function memoryTool(context: ToolContext) {
  const { store, message } = context;

  return tool(
    context,
    "memory",
    "查询、保存或删除请求者在本群的长期记忆。recall 最多返回 6 项；remember 用相同 key 更新，每人最多 40 项；forget 不删除原始聊天和纪要。",
    parameters,
    async (args) => {
      switch (args.action) {
        case "recall": {
          const query = (args.query ?? "").trim();
          const matches = (
            await store.memories.list(message.groupId, message.userId)
          ).filter(
            (item) => item.key.includes(query) || item.content.includes(query),
          );

          return { memories: matches.slice(0, 6), matches: matches.length };
        }

        case "remember": {
          await store.memories.remember(
            message,
            args.key.trim(),
            args.content.trim(),
          );

          return "记忆已保存。";
        }

        case "forget": {
          const removed = await store.memories.forget(message, args.key.trim());

          return removed
            ? "这项记忆已删除，原始聊天和纪要仍保留。"
            : "没有找到这项记忆。";
        }
      }
    },
  );
}
