import { Type } from "typebox";

import { selectSources, sourceScope } from "../../recording/sources.ts";
import { beijingTime } from "../../utils/time.ts";
import type { ToolContext } from "./context.ts";
import {
  directive,
  getTopic,
  object,
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
        "要从整个范围找出的内容，例如所有优化建议及其理由、约束和分歧；省略时整理全部内容。",
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
  object({ action: Type.Literal("send"), topicId }),
  object({ action: Type.Literal("hold"), topicId }),
]);

export function recordTools(context: ToolContext) {
  const { store, message, notes, wake } = context;

  return [
    tool(
      context,
      "record",
      "新建文档。scope 可指定全部历史、多个话题或消息范围，focus 指定选材要求。后台逐段读取完整范围，无需先搜索话题或逐页读完。可自行拟定标题；directive 省略为自行判断，send 为完成后发送，hold 为只保存。返回任务 ID，可用 task 等待。",
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

        return { ...result, sourceCount: sources.length, focus: topic.focus };
      },
    ),
    tool(
      context,
      "edit_record",
      "操作本群已有纪要：update 修改范围或选材要求，省略的字段沿用原值；send 直接发送数据库全文，尚未完成时安排整理后发送；hold 暂缓全文发送。无需重新输出或读取已有全文。另建文档用 record。",
      editParameters,
      async (args) => {
        let topic = await getTopic(context, args.topicId);

        if (args.action === "update") {
          const sources = args.scope
            ? await selectSources(store, message, args.scope)
            : undefined;

          if (sources?.length === 0) {
            return "这个范围内没有保存的群成员消息，原文档未改动。";
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
          return `「${topic.title}」的纪要先不发，记录仍保存在本地。`;
        }

        const result = await notes.arrange(topic, message.id);

        wake();

        return result;
      },
    ),
  ];
}
