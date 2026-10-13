import { Type } from "typebox";

import type { Subagents } from "../subagents.ts";
import type { ToolContext } from "./context.ts";
import { object, tool } from "./context.ts";

const parameters = object({
  text: Type.String({ minLength: 1, pattern: "\\S" }),
});

export function replyTool(context: ToolContext, subagents: Subagents) {
  const { store, message, wake } = context;

  return tool(
    context,
    "reply",
    "向 QQ 群发送一次最终答复，等待发送结果后结束本次对话。text 必须是非空文字。先完成必要的查询、记忆更新和操作，按问题所需详略回答，不发内部分析或无关状态。不需要发言时用 skip_reply。发纪要用 edit_record(action=send)，不在这里重复输出全文。",
    parameters,
    async ({ text }, signal) => {
      subagents.assertIdle();

      const key = `command:${message.id}`;

      const delivery = await store.deliveries.enqueue(key, {
        kind: "text",
        groupId: message.groupId,
        content: text,
      });

      wake();
      const state = await store.deliveries.wait(delivery.id, signal);

      return {
        state,
        message:
          state === "done"
            ? "答复已发到 QQ 群，本次对话结束。"
            : state === "failed"
              ? "QQ 发送失败，回复已保留，可以重试发送。"
              : "回复已取消，不要声称已发送。",
      };
    },
  );
}

export const skipReplyTool = (context: ToolContext, subagents: Subagents) =>
  tool(
    context,
    "skip_reply",
    "不向 QQ 群发送消息，结束本次对话。按当前请求和记忆决定保持安静时使用，例如群友之间的讨论、安静保存记忆、约定减少接话，或其他工具已交付结果且无需补充答复。先完成必要的操作，并完成或取消查阅任务。",
    object({}),
    async () => {
      subagents.assertIdle();

      return { state: "silent" };
    },
  );

export function notifyTool(context: ToolContext) {
  const { store, message, wake } = context;

  return tool(
    context,
    "notify",
    "根据子 agent 返回的元数据、内容简报或整理结果中的资料规模和复杂程度，自主判断有较多工作仍需处理时，向群里发一次简短提示。元数据已足够判断时无需等正文读完。不能仅因等待超时、响应慢或任务未完成而调用。只说实际正在整理的内容，不说已完成，不播报内部任务 ID 或子 agent。发完继续处理，不结束对话；同一次请求最多发一次。最终答复用 reply，无需再发言时用 skip_reply。",
    object({ text: Type.String({ minLength: 1, pattern: "\\S" }) }),
    async ({ text }, signal) => {
      const key = `progress:${message.id}`;
      const delivery = await store.deliveries.enqueue(key, {
        kind: "text",
        groupId: message.groupId,
        content: text,
      });

      wake();

      return {
        state: await store.deliveries.wait(delivery.id, signal),
        message: "本次请求的进度提示只发送一次，请继续处理。",
      };
    },
  );
}
