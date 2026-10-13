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
  object({ action: Type.Literal("send"), topicId, revision }),
  object({ action: Type.Literal("hold"), topicId }),
]);

export function recordTools(context: ToolContext) {
  const { store, message, notes, wake } = context;

  return [
    tool(
      context,
      "record",
      "新建独立文档，从第 1 版开始。修改、补全或重做已有文档用 edit_record(action=update)，保留同一 topicId。先依据请求和上下文确定范围；指代或讨论开头不清时，用 read(context) 回溯。scope 可指定消息起止 ID、全部历史、多个话题或时间范围，focus 指定整理要求。后台读取完整范围，不只整理你看到的片段。可自行拟定标题；directive 省略为自行判断，send 为完成后发送，hold 为只保存。返回任务 ID，可用 task 等待。",
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
      "操作本群已有纪要：update 在同一 topicId 下创建下一版，保留旧版；scope 或 focus 可修改范围和整理要求，省略则按原范围和要求重新整理，无需新消息。send 直接发送数据库全文，可用 revision 指定第几版；省略时发送最新内容，尚未整理完成则等整理后发送。hold 暂缓全文发送。无需重新输出或读取已有全文。只有另建独立文档才用 record。",
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
          await store.deliveries.enqueue(
            `requested:${message.id}:${topic.id}:${note.revision}`,
            { kind: "note", note, repeat: true },
          );
          wake();

          return {
            topicId: topic.id,
            title: topic.title,
            revision: note.revision,
            path: note.path,
            state: "sending",
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
