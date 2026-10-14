import { Type } from "typebox";

import type { Subagents } from "../subagents.ts";
import type { RequestContext, ToolContext } from "./context.ts";
import { object, replyTo, resolveReply, tool } from "./context.ts";

export const hasBackgroundDelivery = async ({
  store,
  message,
}: RequestContext) =>
  (await store.jobs.publishesRequest(message.groupId, message.id)) ||
  (await store.deliveries.forRequest(message.id)).some(
    (delivery) =>
      delivery.kind === "note" &&
      (delivery.state === "pending" || delivery.state === "done"),
  );

const parameters = object({
  text: Type.String({ minLength: 1, pattern: "\\S" }),
  replyTo,
});

export function replyTool(context: ToolContext, subagents: Subagents) {
  const { store, message, wake } = context;

  return tool(
    context,
    "reply",
    "发送非空 text 作为最终答复，并结束本次请求。先完成必要操作，再调用；纪要交给后台后程序直接结束，不再额外回复。篇幅按问题所需信息决定。进度提示用 notify，安静结束用 skip_reply，发送纪要全文用 edit_record(send)。",
    parameters,
    async ({ text, replyTo }, signal) => {
      subagents.assertIdle();
      if (await hasBackgroundDelivery(context)) {
        return {
          state: "deferred",
          message: "本次纪要已交给后台，全部完成后统一交付，本轮不再另发回复。",
        };
      }

      const key = `command:${message.id}`;

      const delivery = await store.deliveries.enqueue(key, {
        kind: "text",
        groupId: message.groupId,
        content: text,
        replyTo: await resolveReply(context, replyTo),
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
    "结束本次请求，不发群消息。用于无需回应、安静保存偏好，或其他工具已负责交付结果的情况。先落实必要操作并处理耗时提示，完成或取消查阅任务，再调用。",
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
    "发送一次简短进度提示，随后继续处理。需要查阅资料后直接回答问题，且助手 metadata/brief 已表明剩余查阅较多时调用，无需等正文读完。纪要由后台完成后统一交付。只说明实际处理的内容，不估计未知时间；响应慢或任务未完成本身不是依据。每次请求最多一次，明确静默要求时不发。最终答复用 reply，无需补充时用 skip_reply。",
    parameters,
    async ({ text, replyTo }, signal) => {
      if (await hasBackgroundDelivery(context)) {
        return {
          state: "deferred",
          message: "本批纪要整理完成后统一发消息，本轮无需另发通知。",
        };
      }

      const key = `progress:${message.id}`;
      const delivery = await store.deliveries.enqueue(key, {
        kind: "text",
        groupId: message.groupId,
        content: text,
        replyTo: await resolveReply(context, replyTo),
      });

      wake();

      return {
        state: await store.deliveries.wait(delivery.id, signal),
        message: "本次请求的进度提示只发送一次，请继续处理。",
      };
    },
  );
}
