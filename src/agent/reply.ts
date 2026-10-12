import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type { Store } from "../storage/store.ts";
import type { Message } from "../types.ts";

const parameters = Type.Object(
  { text: Type.String({ minLength: 1, pattern: "\\S" }) },
  { additionalProperties: false },
);

export function replyTool(
  store: Store,
  message: Message,
): AgentTool<typeof parameters> {
  return {
    name: "reply",
    label: "群回复",
    description:
      "向当前 QQ 群回复文字，用于回答、确认、澄清或自然对话。回复入队后独立发送，不必等待本次 Agent 结束。只写给群成员看的内容，不发送内部分析。整理已安排时可以说已开始，不能说记好了；完成后后台会通知。一次请求只调用一次；发送纪要用 send。",
    parameters,
    execute: async (_id, { text }) => {
      if ((await store.message(message.id)).recalledAt !== null) {
        throw new Error("这次请求已撤回");
      }

      await store.deliveries.enqueue(`command:${message.id}`, {
        kind: "text",
        groupId: message.groupId,
        content: text,
      });

      return {
        content: [{ type: "text", text: "回复已加入发送队列。" }],
        details: {},
      };
    },
  };
}
