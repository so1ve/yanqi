import { Type } from "typebox";

import type { ToolContext } from "./context.ts";
import { object, tool } from "./context.ts";

const parameters = object({
  text: Type.Union([
    Type.String({ minLength: 1, pattern: "\\S" }),
    Type.Null({ description: "明确决定不向群里发言时使用 null。" }),
  ]),
});

export function replyTool(context: ToolContext) {
  const { store, message, wake } = context;

  return tool(
    context,
    "reply",
    "结束本次对话。text 为文字时向 QQ 群回复一次，为 null 时不发消息。用户直接叫你、提问或要求回应时应答复；群友之间的讨论或其他工具已经交付结果时可用 null。先完成必要的查询和操作，按问题所需详略回答，不发内部分析或无关状态。发纪要用 edit_record(action=send)，随后用 null 结束。",
    parameters,
    async ({ text }, signal) => {
      if (text === null) {
        return { state: "silent" };
      }

      const key = `command:${message.id}`;

      await store.deliveries.enqueue(key, {
        kind: "text",
        groupId: message.groupId,
        content: text,
      });

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
  );
}
