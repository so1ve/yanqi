import { Type } from "typebox";

import type { Subagents } from "../subagents.ts";
import type { ToolContext } from "./context.ts";
import { object, tool } from "./context.ts";

const parameters = object({
  text: Type.Union([
    Type.String({ minLength: 1, pattern: "\\S" }),
    Type.Null({ description: "明确决定不向群里发言时使用 null。" }),
  ]),
});

export function replyTool(context: ToolContext, subagents: Subagents) {
  const { store, message, wake } = context;

  return tool(
    context,
    "reply",
    "结束本次对话。text 为文字时向 QQ 群回复一次，为 null 时不发消息。用户直接叫你、提问或要求回应时应答复；群友之间的讨论或其他工具已经交付结果时可用 null。先完成必要的查询和操作，按问题所需详略回答，不发内部分析或无关状态。发纪要用 edit_record(action=send)，随后用 null 结束。",
    parameters,
    async ({ text }, signal) => {
      subagents.assertIdle();

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

export function notifyTool(context: ToolContext) {
  const { store, message, wake } = context;

  return tool(
    context,
    "notify",
    "耗时较长时，向群里发一次简短进度提示，发完继续处理，不结束对话。只说正在整理的内容或具体等待原因，不说已完成，不播报内部任务 ID 或子 agent。无需为普通快速请求发提示；同一次请求最多发一次。最终答复用 reply。",
    object({ text: Type.String({ minLength: 1, pattern: "\\S" }) }),
    async ({ text }, signal) => {
      const key = `progress:${message.id}`;
      const added = await store.deliveries.enqueue(key, {
        kind: "text",
        groupId: message.groupId,
        content: text,
      });

      wake();

      return {
        state: await store.deliveries.wait(key, signal),
        repeated: !added,
        message: "本次请求的进度提示只发送一次，请继续处理。",
      };
    },
  );
}
