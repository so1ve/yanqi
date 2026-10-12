import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type { Store } from "../storage/store.ts";
import type { Message } from "../types.ts";
import { MAX_REPLY_CHARS } from "./prompts.ts";

const parameters = Type.Object(
  {
    text: Type.String({
      minLength: 1,
      maxLength: MAX_REPLY_CHARS,
      pattern: "\\S",
    }),
  },
  { additionalProperties: false },
);

export function replyTool(
  store: Store,
  message: Message,
): AgentTool<typeof parameters> {
  return {
    name: "reply",
    label: "群回复",
    description: `向当前 QQ 群回复一两句，通常 60 字以内，最多 ${MAX_REPLY_CHARS} 个字符。只说当前问题的答复，不发内部分析、无关状态或操作菜单。整理已安排时只能说已开始，完成后后台会通知。回复入队后独立发送，一次请求只调用一次；发送纪要用 send。`,
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
