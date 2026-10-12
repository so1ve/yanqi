import type { AgentState, AgentTool } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "typebox";
import { Type } from "typebox";

import type { Store } from "../storage/store.ts";
import type { Message, Topic } from "../types.ts";
import type { Notes } from "./notes.ts";

const directive = Type.Union([
  Type.Literal("auto"),
  Type.Literal("send"),
  Type.Literal("hold"),
]);
const topicId = Type.String({ minLength: 1 });
const title = Type.Optional(Type.String({ minLength: 1, maxLength: 100 }));
const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const recordParameters = object({
  scope: Type.Union([
    object({ topicId }),
    object({
      sourceIds: Type.Array(Type.String({ pattern: "^m[1-9][0-9]*$" }), {
        minItems: 1,
      }),
    }),
    object({ minutes: Type.Integer({ minimum: 1, maximum: 1440 }) }),
  ]),
  title,
  directive,
});
const topicParameters = object({ topicId });
const emptyParameters = object({});

export function recordingTools(
  store: Store,
  notes: Notes,
  message: Message,
  isAdmin: boolean,
  sourceIds: Set<string>,
): AgentState["tools"] {
  async function getTopic(id: string) {
    const topic = await store.topic(id);

    if (topic.groupId !== message.groupId) {
      throw new Error("只能处理本群话题");
    }

    return topic;
  }

  const tool = <P extends TSchema>(
    name: string,
    description: string,
    parameters: P,
    execute: (args: Static<P>) => Promise<string>,
  ): AgentTool<P> => ({
    name,
    label: name,
    description,
    parameters,
    execute: async (_id, args) => {
      if ((await store.message(message.id)).recalledAt !== null) {
        throw new Error("这次请求已撤回");
      }

      return {
        content: [{ type: "text", text: await execute(args) }],
        details: {},
      };
    },
  });

  async function arrange(topic: Topic, send: boolean): Promise<string> {
    const note = await store.latestNote(topic.id);

    if (note?.generation === topic.generation) {
      if (send) {
        await store.deliveries.enqueue(
          `requested:${message.id}:${topic.id}`,
          message.groupId,
          topic.id,
          note.id,
          "note",
          note.markdown,
        );
      }

      return `「${topic.title}」已保存在本地，第 ${note.revision} 版。${send ? "已安排发送。" : ""}`;
    }

    if (!topic.lastSourceId) {
      return "这段记录里还没有可整理的消息。";
    }

    await notes.schedule(topic, true);

    return send ? "正在整理这份纪要，保存完成后发出来。" : "正在整理这段讨论。";
  }

  return [
    tool(
      "record",
      "整理已有讨论。scope 选择一个范围：本群话题、指定原文 ID 或最近多少分钟。directive 表示发送、暂缓或自行判断。",
      recordParameters,
      async (args) => {
        if ("topicId" in args.scope) {
          const topic = await getTopic(args.scope.topicId);

          if (args.directive !== "auto") {
            await store.setDirective(topic.id, args.directive, message.id);
          }

          return arrange(topic, args.directive === "send");
        }

        const sources =
          "sourceIds" in args.scope
            ? await Promise.all(
                [...new Set(args.scope.sourceIds)].map(async (id) => {
                  if (!sourceIds.has(id)) {
                    throw new Error("记录来源必须是已提供的本群成员原文");
                  }

                  const source = await store.message(Number(id.slice(1)));

                  if (source.isBot) {
                    throw new Error("记录来源必须是群成员的原文");
                  }

                  return source;
                }),
              )
            : await store.window(
                message.groupId,
                message.sentAt - args.scope.minutes * 60_000,
                message.id - 1,
              );

        if (sources.length === 0) {
          return "这个时间范围内没有可整理的消息。群消息仍会继续保存。";
        }

        const topic = await store.createTopic(
          message.groupId,
          args.title ||
            `讨论记录 ${new Date(message.sentAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
          "manual",
          message.userId,
          sources.map((source) => source.id),
          message.receivedAt,
          args.directive,
          message.id,
        );

        await store.closeTopic(topic.id);
        await notes.schedule(await store.topic(topic.id));

        return `已选中 ${sources.length} 条原文，正在整理。编号 ${topic.id.slice(0, 8)}。`;
      },
    ),
    tool(
      "start",
      "从当前请求之后开始连续记录。每位成员在本群同时只发起一段连续记录。",
      object({ title, directive }),
      async (args) => {
        const existing = await store.manualTopics(
          message.groupId,
          message.userId,
        );

        if (existing.length > 0) {
          return `你已有正在进行的记录：${existing.map((topic) => `「${topic.title}」`).join("、")}。先结束它，再开始新的。`;
        }

        const following = (
          await store.window(
            message.groupId,
            message.sentAt,
            Number.MAX_SAFE_INTEGER,
          )
        ).filter((item) => item.id > message.id);
        const topic = await store.createTopic(
          message.groupId,
          args.title || "连续讨论记录",
          "manual",
          message.userId,
          following.map((item) => item.id),
          message.receivedAt,
          args.directive,
          message.id,
        );

        return `开始记录「${topic.title}」，编号 ${topic.id.slice(0, 8)}。聊完后 @ 我结束记录，我会整理纪要。`;
      },
    ),
    tool(
      "stop",
      "结束连续记录并整理。未指定 topicId 时选择请求者的连续记录。只有发起人或管理员可以结束。",
      object({ topicId: Type.Optional(topicId), directive }),
      async (args) => {
        const owned = await store.manualTopics(message.groupId, message.userId);
        const topic = args.topicId ? await getTopic(args.topicId) : owned[0];

        if (topic?.mode !== "manual" || topic.state !== "active") {
          return "没有找到正在进行的手动记录。";
        }

        if (!isAdmin && topic.ownerId !== message.userId) {
          return "请记录的发起人或管理员结束这段记录。";
        }

        if (args.directive !== "auto") {
          await store.setDirective(topic.id, args.directive, message.id);
        }

        await store.closeTopic(topic.id);
        await notes.schedule(await store.topic(topic.id));

        return topic.lastSourceId
          ? "这段记录已结束，正在整理纪要。"
          : "这段记录已结束，里面还没有需要整理的消息。";
      },
    ),
    tool(
      "send",
      "向当前群发送指定话题的完整纪要，尚未保存时先整理。",
      topicParameters,
      async ({ topicId }) => {
        const topic = await getTopic(topicId);

        await store.setDirective(topic.id, "send", message.id);

        return arrange(topic, true);
      },
    ),
    tool(
      "hold",
      "暂缓指定话题的纪要发送，保留本地档案。",
      topicParameters,
      async ({ topicId }) => {
        const topic = await getTopic(topicId);

        await store.setDirective(topic.id, "hold", message.id);

        return `「${topic.title}」的纪要先不发，记录仍保存在本地。`;
      },
    ),
    tool(
      "search",
      "查找本群记录，返回标题、完整 ID 和整理状态。",
      object({
        query: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
      }),
      async ({ query }) => {
        const matches = await store.search(message.groupId, query.trim());

        return matches.length > 0
          ? JSON.stringify(
              matches.map(({ id, title, state, revision }) => ({
                id,
                title,
                state,
                revision,
              })),
            )
          : "本群没有找到匹配的记录。";
      },
    ),
    tool(
      "status",
      "查询本群记录数量、自动整理开关及任务状态。",
      emptyParameters,
      () => store.status(message.groupId),
    ),
    tool(
      "retry",
      "重试本群失败任务，需要管理员权限。",
      emptyParameters,
      async () =>
        isAdmin
          ? `已重新安排本群 ${await store.jobs.retryFailed(message.groupId)} 个失败任务。`
          : "只有群主、群管理员或配置中的管理员可以重试任务。",
    ),
    tool(
      "automatic",
      "开启或暂停本群自动整理。暂停后继续保存原文和处理 @ 请求，需要管理员权限。",
      object({ enabled: Type.Boolean() }),
      async ({ enabled }) => {
        if (!isAdmin) {
          return "只有群主、群管理员或配置中的管理员可以修改自动整理开关。";
        }

        await store.setAI(message.groupId, enabled);

        return `已${enabled ? "开启" : "暂停"}本群自动整理。群消息会继续保存，也可以 @ 我提出记录要求。`;
      },
    ),
  ];
}
