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

export const progress = Type.Optional(
  Type.String({
    minLength: 1,
    pattern: "\\S",
    description:
      "可选的一句接手提示。根据本次资料规模和剩余工作判断确实需要较多整理、查阅或附件解析时填写；普通短任务、直接发送已有结果或明确要求静默时省略。操作成功安排后引用触发消息发送，整次请求最多一次。",
  }),
);

// 查阅与整理共用请求键，先发过查阅提示的请求不会在逐篇整理时再次播报。
export async function sendProgress(
  { store, message, wake }: ToolContext,
  text: string | undefined,
  signal?: AbortSignal,
) {
  if (text === undefined) {
    return undefined;
  }

  const delivery = await store.deliveries.enqueue(`progress:${message.id}`, {
    kind: "text",
    groupId: message.groupId,
    content: text,
    replyTo: message.messageId,
  });

  wake();

  return { state: await store.deliveries.wait(delivery.id, signal) };
}

export const notifyTool = (context: ToolContext, subagents: Subagents) =>
  tool(
    context,
    "notify",
    "查阅助手的 metadata/brief 表明仍有较多工作时，引用触发消息发送一句接手提示，随后继续处理。助手已完成则直接使用结果。整理和等待附件用对应操作的 progress 参数，不另调 notify。提示只说明实际处理内容，不估计未知时间；整次请求最多一次，明确静默时不发。",
    object({ text: Type.String({ minLength: 1, pattern: "\\S" }) }),
    async ({ text }, signal) => {
      if (await hasBackgroundDelivery(context)) {
        return {
          state: "deferred",
          message: "本批纪要整理完成后统一发消息，本轮无需另发通知。",
        };
      }

      if (!subagents.hasPendingRead()) {
        return {
          state: "skipped",
          message:
            "没有已返回元数据且仍在查阅的助手，直接使用已有结果或先安排实际操作。",
        };
      }

      return sendProgress(context, text, signal);
    },
  );
