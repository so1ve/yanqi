import { Type } from "typebox";

import {
  recordSelection,
  selectSources,
  sourceScope,
} from "../../recording/sources.ts";
import type { ToolContext } from "./context.ts";
import {
  directive,
  getTopic,
  object,
  replyTo,
  resolveReply,
  revision,
  tool,
  topicId,
} from "./context.ts";

const createParameters = object({
  records: Type.Array(recordSelection, {
    minItems: 1,
    description:
      "本次要新建的纪要，每项是一份独立文档。普通整理填一项，分点记录或分别记录不同聊天内容时按话题填多项。",
  }),
  directive,
  replyTo,
});
const editParameters = Type.Union([
  object({
    action: Type.Literal("update"),
    topicId,
    scope: Type.Optional(sourceScope),
    focus: Type.Optional(Type.String()),
    directive,
    replyTo,
  }),
  object({ action: Type.Literal("send"), topicId, revision, replyTo }),
  object({ action: Type.Literal("hold"), topicId }),
]);

export function recordTools(context: ToolContext) {
  const { store, message, notes, wake } = context;

  return [
    tool(
      context,
      "record",
      "一次新建 records 中的全部独立纪要，各从第 1 版开始。每项给出 title、scope，拆分时用 focus 限定本篇主题；范围可重叠。同一请求的多份纪要一起提交，范围或主题划分不清时先委派 history 助手。先校验全部范围再创建；范围为空或无效时整批不创建，修正后重试。后台逐篇读取原文和附件，全部结束后统一交付。成功安排后程序直接结束主对话，不再调用模型；先完成所需查询和其他操作，再把全部纪要一起提交。范围无效或操作报错时继续修正。directive 对整批生效，省略为 auto，send 完成后发送，hold 暂缓全文。修改已有纪要用 edit_record(update)。",
      createParameters,
      async (args) => {
        const quote = await resolveReply(context, args.replyTo);
        const selections = [];

        // 先解析整批范围，避免后一项无效时留下前面已经创建的纪要。
        for (const record of args.records) {
          const sources = await selectSources(store, message, record.scope);

          if (sources.length === 0) {
            throw new Error(
              `「${record.title}」的范围内没有本地保存的群成员消息，本批纪要尚未创建。`,
            );
          }

          selections.push({
            title: record.title,
            messages: sources.map((source) => source.id),
            focus: record.focus ?? "",
            directive: args.directive ?? "auto",
          });
        }

        const topics = await store.recordings.create(message, selections);
        const records = [];

        for (const topic of topics) {
          records.push(await notes.arrange(topic, message.id, quote));
        }

        wake();

        return { records };
      },
    ),
    tool(
      context,
      "edit_record",
      "操作已有纪要。update 沿用 topicId 生成下一版并保留旧版；scope、focus 省略时按原要求重做，可在没有新消息时调用。send 直接发送全文，revision 省略用最新内容，尚未完成则整理后发送；无需先读取正文。hold 暂缓全文。成功安排整理或发送后，程序在本轮工具执行完毕时结束主对话，由后台统一交付；所需查询先完成，多篇修改或发送在同一轮调用。只有明确另存独立文档才用 record。",
      editParameters,
      async (args) => {
        let topic = await getTopic(context, args.topicId);
        const quote = await resolveReply(
          context,
          args.action === "hold" ? undefined : args.replyTo,
        );

        if (args.action === "send" && args.revision !== undefined) {
          const note = await store.notes.find(topic.id, args.revision);

          if (!note) {
            throw new Error(
              `「${topic.title}」没有已保存的第 ${args.revision} 版`,
            );
          }

          await store.topics.setDirective(topic.id, "send", message.id);
          const delivery = await store.deliveries.enqueueNote(
            note,
            message.id,
            quote,
          );

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

        const result = await notes.arrange(topic, message.id, quote);

        wake();

        return result;
      },
    ),
  ];
}
