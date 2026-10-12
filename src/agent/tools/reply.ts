import { Type } from "typebox";

import { MAX_REPLY_CHARS } from "../prompts/common.ts";
import type { ToolContext } from "./context.ts";
import { assertActive, object, tool } from "./context.ts";

const parameters = object({
  text: Type.String({
    minLength: 1,
    maxLength: MAX_REPLY_CHARS,
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
  const { store, message, ai, wake } = context;

  return tool(
    context,
    "reply",
    `向 QQ 群回复一两句，通常 60 字以内，最多 ${MAX_REPLY_CHARS} 字符。只答当前问题，不发内部分析、无关状态或菜单。等待实际发送结果；一次请求只调用一次，发纪要用 edit_record(action=send)。`,
    parameters,
    async ({ text, waitForReply }, signal) => {
      const key = `command:${message.id}`;
      const reply = await ai.dialog.voice(message.groupId, text);

      signal?.throwIfAborted();
      await assertActive(context);

      const enqueued = await store.deliveries.enqueue(key, {
        kind: "text",
        groupId: message.groupId,
        content: reply,
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
  );
}
