import { Type } from "typebox";

import type { Messenger } from "../../onebot/messenger.ts";
import type { ToolContext } from "./context.ts";
import { object, tool } from "./context.ts";

const parameters = object({
  text: Type.String({
    minLength: 1,
    pattern: "\\S",
  }),
  waitForReply: Type.Optional(
    Type.Boolean({
      description: "需要请求者补充信息时设为 true，其下一句无需 @ 即可继续。",
    }),
  ),
});

export function replyTool(context: ToolContext, messenger: Messenger) {
  const { store, message, wake } = context;

  return tool(
    context,
    "reply",
    "向 QQ 群发送一次回复并结束对话。用户直接叫你、提问或要求回应时使用，不需要先有记录任务。群友之间的讨论和陈述可静默结束。先完成必要的查询和操作，按问题所需详略回答，不发内部分析或无关状态。发纪要用 edit_record(action=send)。",
    parameters,
    async ({ text, waitForReply }, signal) => {
      const key = `command:${message.id}`;
      const enqueued = await store.deliveries.enqueue(key, {
        kind: "text",
        groupId: message.groupId,
        content: text,
      });

      if (enqueued && waitForReply) {
        const next = await store.messages.awaitReply(message);

        if (next) {
          void messenger.acknowledge(next);
        }
      }

      wake();
      const state = await store.deliveries.wait(key, signal);

      return {
        state,
        message:
          state === "done"
            ? "答复已发到 QQ 群，本次对话结束。"
            : state === "failed"
              ? "QQ 发送失败，回复已保留，可以重试发送。"
              : "QQ 尚未确认发送，回复已保留，不要重复回复或声称已发送。",
      };
    },
    { terminate: true },
  );
}
