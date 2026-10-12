import { Type } from "typebox";

import type { ToolContext } from "./context.ts";
import { object, tool } from "./context.ts";

const parameters = object({
  text: Type.String({
    minLength: 1,
    pattern: "\\S",
  }),
  waitForReply: Type.Optional(
    Type.Boolean({
      description:
        "确实需要请求者下一句补充时设为 true，其下一句无需 @ 即可继续。",
    }),
  ),
});

export function replyTool(context: ToolContext) {
  const { store, message, wake } = context;

  return tool(
    context,
    "reply",
    "向 QQ 群发送答复并结束本次对话。先完成必要的查询和操作，最后调用一次。按问题所需详略回答，不限字数，不发内部分析或无关状态。发纪要用 edit_record(action=send)。",
    parameters,
    async ({ text, waitForReply }, signal) => {
      const key = `command:${message.id}`;
      const enqueued = await store.deliveries.enqueue(key, {
        kind: "text",
        groupId: message.groupId,
        content: text,
      });

      if (enqueued && waitForReply) {
        await store.messages.awaitReply(message);
      }

      wake();
      const state = await store.deliveries.wait(key, signal);

      return {
        state,
        message:
          state === "done"
            ? "已发送到 QQ 群，本次答复结束，不再补发状态。"
            : state === "failed"
              ? "QQ 发送失败，回复已保留，可由管理员重试发送。"
              : "QQ 尚未确认发送，回复已保留，不要重复回复或声称已发送。",
      };
    },
    { terminate: true },
  );
}
