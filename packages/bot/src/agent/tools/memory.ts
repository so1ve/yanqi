import { Type } from "typebox";

import {
  memoryContent,
  memoryKey,
  memoryScope,
} from "../../storage/memories.ts";
import type { ToolContext } from "./context.ts";
import { object, tool } from "./context.ts";

const parameters = Type.Union([
  object({
    action: Type.Literal("recall"),
    scope: memoryScope,
    query: Type.Optional(Type.String({ maxLength: 100 })),
  }),
  object({
    action: Type.Literal("remember"),
    scope: memoryScope,
    key: memoryKey,
    content: memoryContent,
  }),
  object({
    action: Type.Literal("forget"),
    scope: memoryScope,
    key: memoryKey,
  }),
]);

export function memoryTool(context: ToolContext) {
  const { store, message } = context;

  return tool(
    context,
    "memory",
    "查询、保存或删除记忆。scope=group 是当前群的共享约定和背景，scope=user 是当前请求者跨群使用的个人偏好。对话中主动保存长期有用的偏好与更正，不必等用户说记住。remember 用原 key 更新；forget 不删除聊天和纪要。每个范围最多 40 项。",
    parameters,
    async (args) => {
      const owner = {
        scope: args.scope,
        ownerId: args.scope === "group" ? message.groupId : message.userId,
      };

      switch (args.action) {
        case "recall": {
          const query = (args.query ?? "").trim();
          const matches = (await store.memories.list(owner)).filter(
            (item) => item.key.includes(query) || item.content.includes(query),
          );

          return { scope: args.scope, memories: matches };
        }

        case "remember": {
          await store.memories.remember(
            owner,
            args.key.trim(),
            args.content.trim(),
            message.id,
          );

          return {
            saved: true,
            scope: args.scope,
            key: args.key,
            content: args.content,
          };
        }

        case "forget": {
          const removed = await store.memories.forget(
            owner,
            args.key.trim(),
            message.id,
          );

          return removed
            ? "这项记忆已删除，原始聊天和纪要仍保留。"
            : "没有找到这项记忆。";
        }
      }
    },
  );
}
