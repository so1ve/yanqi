import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type { Store } from "../storage/store.ts";
import type { Message } from "../types.ts";
import type { Ai } from "./models.ts";
import { MAX_REPLY_CHARS } from "./prompts.ts";

const parameters = Type.Object(
  {
    waitForReply: Type.Optional(
      Type.Boolean({
        description:
          "本次确实向请求者提问、需要其下一句补充时设为 true。其下一句无需 @ 即可继续。",
      }),
    ),
    text: Type.String({
      minLength: 1,
      maxLength: MAX_REPLY_CHARS,
      pattern: "\\S",
    }),
  },
  { additionalProperties: false },
);

export const replyTool = (
  store: Store,
  message: Message,
  ai: Ai,
  processPending: () => void,
): AgentTool<typeof parameters> => ({
  name: "reply",
  label: "群回复",
  description: `向当前 QQ 群回复一两句，通常 60 字以内，最多 ${MAX_REPLY_CHARS} 个字符。只说当前问题的答复，不发内部分析、无关状态或操作菜单。等待 QQ 发送结果后返回。一次请求只调用一次；发送纪要用 send。`,
  parameters,
  execute: async (_id, { text, waitForReply }, signal) => {
    if ((await store.message(message.id)).recalledAt !== null) {
      throw new Error("这次请求已撤回");
    }

    const key = `command:${message.id}`;
    const reply = await ai.voice(message.groupId, text);

    signal?.throwIfAborted();
    if ((await store.message(message.id)).recalledAt !== null) {
      throw new Error("这次请求已撤回");
    }

    const enqueued = await store.deliveries.enqueue(key, {
      kind: "text",
      groupId: message.groupId,
      content: reply,
    });

    if (enqueued && waitForReply) {
      await store.awaitReply(message);
    }

    processPending();
    const state = await store.deliveries.wait(key, signal);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            state,
            message:
              state === "done"
                ? "已发送到 QQ 群，本次答复结束，不再补发状态说明。"
                : state === "failed"
                  ? "QQ 发送失败。回复已保留，可由管理员重试发送。"
                  : "QQ 尚未确认发送，回复已保留。不要重复回复或声称已发送。",
          }),
        },
      ],
      details: {},
    };
  },
});
