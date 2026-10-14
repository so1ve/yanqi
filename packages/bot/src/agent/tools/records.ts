import { Type } from "typebox";

import { selectSources, sourceScope } from "../../recording/sources.ts";
import { beijingTime } from "../../utils/time.ts";
import type { ToolContext } from "./context.ts";
import {
  directive,
  getTopic,
  object,
  revision,
  title,
  tool,
  topicId,
} from "./context.ts";

const createParameters = object({
  scope: sourceScope,
  title,
  focus: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "用户的选材目的和详略要求，例如找出优化建议及关键理由。概括整个讨论时省略，默认提炼主要议题；不要把识图描述或查阅简报当成用户要求。",
    }),
  ),
  directive,
});
const editParameters = Type.Union([
  object({
    action: Type.Literal("update"),
    topicId,
    scope: Type.Optional(sourceScope),
    focus: Type.Optional(Type.String()),
    directive,
  }),
  object({ action: Type.Literal("send"), topicId, revision }),
  object({ action: Type.Literal("hold"), topicId }),
]);

export function recordTools(context: ToolContext) {
  const { store, message, notes, wake } = context;

  return [
    tool(
      context,
      "record",
      "按当前请求新建独立纪要，第 1 版。scope 指定完整范围，focus 仅写用户选材要求，标题可自拟。已知范围直接调用，范围不明再委派 history 助手。后台读取全部原文及附件，返回任务 ID、状态和 workload；有较多剩余工作时 notify 一次，再 skip_reply 让后台交付，仅后续操作依赖结果时等待。directive 省略为 auto，send 为完成后发送，hold 为暂缓全文。修改已有文档用 edit_record(update)；谈论记录功能不调用。",
      createParameters,
      async (args) => {
        const sources = await selectSources(store, message, args.scope);

        if (sources.length === 0) {
          return "这个范围内没有本地保存的群成员消息。";
        }

        const topic = await store.recordings.create(message, {
          title: args.title || `讨论记录 ${beijingTime(message.sentAt)}`,
          messages: sources.map((source) => source.id),
          focus: args.focus ?? "",
          directive: args.directive ?? "auto",
        });
        const result = await notes.arrange(topic, message.id);

        wake();

        return result;
      },
    ),
    tool(
      context,
      "edit_record",
      "操作已有纪要。update 沿用 topicId 生成下一版并保留旧版；scope、focus 省略时按原要求重做，可在没有新消息时调用。send 直接发送全文，revision 省略用最新内容，尚未完成则整理后发送；无需先读取正文。hold 暂缓全文。整理时返回 workload，按剩余工作判断是否 notify，之后让后台交付；只有明确另存独立文档才用 record。",
      editParameters,
      async (args) => {
        let topic = await getTopic(context, args.topicId);

        if (args.action === "send" && args.revision !== undefined) {
          const note = await store.notes.find(topic.id, args.revision);

          if (!note) {
            throw new Error(
              `「${topic.title}」没有已保存的第 ${args.revision} 版`,
            );
          }

          await store.topics.setDirective(topic.id, "send", message.id);
          const delivery = await store.deliveries.enqueueNote(note, message.id);

          wake();

          return {
            topicId: topic.id,
            title: topic.title,
            revision: note.revision,
            path: note.path,
            state: "saved",
            delivery,
          };
        }

        if (args.action === "update") {
          const sources = args.scope
            ? await selectSources(store, message, args.scope)
            : undefined;

          if (sources?.length === 0) {
            return "所选范围内没有已保存的群成员消息，文档未修改。";
          }

          topic = await store.recordings.revise(topic.id, {
            ...(sources
              ? { messageIds: sources.map((source) => source.id) }
              : {}),
            ...(args.focus === undefined ? {} : { focus: args.focus }),
          });
        }

        const sending = args.action === "update" ? args.directive : args.action;

        if (sending !== undefined) {
          await store.topics.setDirective(topic.id, sending, message.id);
          topic = await getTopic(context, topic.id);
        }

        if (args.action === "hold") {
          return `已暂缓发送「${topic.title}」。`;
        }

        const result = await notes.arrange(topic, message.id);

        wake();

        return result;
      },
    ),
  ];
}
