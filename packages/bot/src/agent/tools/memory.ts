import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import {
  memoryContent,
  memoryKey,
  memoryScope,
  memorySummary,
} from "../../storage/memories.ts";
import type { Store } from "../../storage/store.ts";
import type { RequestContext } from "./context.ts";
import { object, tool } from "./context.ts";

const readParameters = object({
  scope: memoryScope,
  keys: Type.Array(memoryKey, { minItems: 1, maxItems: 40, uniqueItems: true }),
});

const parameters = Type.Union([
  object({ action: Type.Literal("recall"), ...readParameters.properties }),
  object({
    action: Type.Literal("remember"),
    scope: memoryScope,
    key: memoryKey,
    summary: memorySummary,
    content: memoryContent,
  }),
  object({
    action: Type.Literal("forget"),
    scope: memoryScope,
    key: memoryKey,
  }),
]);

// 工具描述属于提示词，修改遵循 ../prompts/README.md；读写权限由不同工具定义限制。
export const recallMemoryTool = (
  store: Store,
  groupId: string,
  userId?: string | null,
): AgentTool<typeof readParameters> => ({
  name: "recall_memory",
  label: "recall_memory",
  description:
    "按 memory 简介中的 scope 和 keys 读取相关记忆详情。只读当前群和请求者的记忆，不修改记忆。",
  parameters: readParameters,
  execute: async (_id, args, signal) => {
    signal?.throwIfAborted();
    const ownerId = args.scope === "group" ? groupId : userId;

    if (!ownerId) {
      throw new Error("这次整理没有个人记忆范围");
    }

    const memories = await store.memories.read(
      { scope: args.scope, ownerId },
      args.keys,
    );

    return {
      content: [
        { type: "text", text: JSON.stringify({ scope: args.scope, memories }) },
      ],
      details: {},
    };
  },
});

export function memoryTool(context: RequestContext) {
  const { store, message } = context;

  return tool(
    context,
    "memory",
    "主动保存偏好、共同约定、后续安排和进展。group 属于当前群；user 仅为当前发言人的跨群个人偏好。输入只含简介，recall 用 keys 读取选中详情；更新同一事项前先读取旧详情，remember 沿用 key，同时写简介 summary 与详情 content。forget 删除失效条目。保存不发送消息、不创建纪要或提醒。每个范围最多 40 项。",
    parameters,
    async (args) => {
      const owner = {
        scope: args.scope,
        ownerId: args.scope === "group" ? message.groupId : message.userId,
      };

      switch (args.action) {
        case "recall": {
          return {
            scope: args.scope,
            memories: await store.memories.read(owner, args.keys),
          };
        }

        case "remember": {
          const saved = await store.memories.remember(
            owner,
            {
              key: args.key.trim(),
              summary: args.summary.trim(),
              content: args.content.trim(),
            },
            message.id,
          );

          return {
            saved,
            scope: args.scope,
            key: args.key,
            summary: args.summary,
            ...(saved ? {} : { reason: "已有更新的记忆，未覆盖" }),
          };
        }

        case "forget": {
          const removed = await store.memories.forget(
            owner,
            args.key.trim(),
            message.id,
          );

          return { removed, scope: args.scope, key: args.key };
        }
      }
    },
  );
}
