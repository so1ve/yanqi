import type { AgentState, AgentTool } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "typebox";
import { Type } from "typebox";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { Message, Topic } from "../types.ts";
import { messageChunks } from "./messages.ts";
import type { Notes } from "./notes.ts";
import { selectSources, sourceScope } from "./sources.ts";

const directive = Type.Optional(
  Type.Union([
    Type.Literal("auto"),
    Type.Literal("send"),
    Type.Literal("hold"),
  ]),
);
const topicId = Type.String({ minLength: 1 });
const title = Type.Optional(Type.String({ minLength: 1, maxLength: 100 }));
const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const recordParameters = object({
  scope: sourceScope,
  title,
  focus: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "按当前用户要求筛选、整理的目标，例如所有对小栖的优化建议。后台逐段读取整个范围；省略时整理全部内容。",
    }),
  ),
  directive,
});
const topicParameters = object({ topicId });
const emptyParameters = object({});

export function recordingTools(
  store: Store,
  notes: Notes,
  message: Message,
  isAdmin: boolean,
  config: Config,
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
        await store.deliveries.enqueue(`requested:${message.id}:${topic.id}`, {
          kind: "note",
          note,
          repeat: true,
        });
      }

      return send
        ? `「${topic.title}」第 ${note.revision} 版已加入发送队列。`
        : `「${topic.title}」已保存在本地，第 ${note.revision} 版。`;
    }

    if (!topic.lastSourceId) {
      return "这段记录里还没有可整理的消息。";
    }

    await notes.schedule(topic, true);

    return send ? "正在整理这份纪要，保存完成后发出来。" : "正在整理这段讨论。";
  }

  return [
    tool(
      "read_note",
      "读取本群已有纪要的一页正文，供核实细节、回答具体问题。直接发送全文必须调用 send，不要逐页读出再用 reply 重写。",
      object({ topicId, page: Type.Optional(Type.Integer({ minimum: 0 })) }),
      async ({ topicId, page = 0 }) => {
        const topic = await getTopic(topicId);
        const note = await store.latestNote(topic.id);

        if (!note)
          return "这份纪要尚未保存；查看进度用 inspect，读取原文用 read_history。";

        const size = Math.floor(config.AI_INPUT_CHARS / 4);

        return JSON.stringify({
          topicId,
          revision: note.revision,
          page,
          nextPage: (page + 1) * size < note.markdown.length ? page + 1 : null,
          markdown: note.markdown.slice(page * size, (page + 1) * size),
        });
      },
    ),
    tool(
      "read_history",
      "读取本地保存的本群成员原文，包括尚未归入话题的消息和 @ 消息。可从某成员首次发言开始，或按日期、多个话题、消息 ID、全部历史读取。每次返回一页，长消息可能跨页；nextPage 不为空时还有后文。批量找某类内容并另建文档，直接调用 record 的 scope 和 focus，无需逐页读完。",
      object({
        scope: sourceScope,
        page: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      async ({ scope, page = 0 }) => {
        const sources = await selectSources(store, message, scope);
        const pages = await messageChunks(
          store,
          sources,
          Math.floor(config.AI_INPUT_CHARS / 4),
        );

        return JSON.stringify({
          sourceCount: sources.length,
          page,
          nextPage: page + 1 < pages.length ? page + 1 : null,
          messages: pages[page] ?? [],
        });
      },
    ),
    tool(
      "record",
      "从本群历史新建一份文档，可跨多个话题。scope 指定完整检索范围；focus 指定要找的内容，后台会逐段读取全部范围并整理相关观点，保留细节。无需先搜出现有话题或让用户挑消息 ID。title 可自行拟定。directive 省略为自行判断，send 为完成后发送，hold 为只保存。更新已有纪要用 update_record。",
      recordParameters,
      async (args) => {
        const sources = await selectSources(store, message, args.scope);

        if (sources.length === 0) {
          return "这个范围内没有本地保存的群成员消息。";
        }

        const topic = await store.createRecording(message, {
          title:
            args.title ||
            `讨论记录 ${new Date(message.sentAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
          messages: sources.map((source) => source.id),
          focus: args.focus ?? "",
          directive: args.directive ?? "auto",
        });

        await notes.schedule(topic, true);

        return JSON.stringify({
          topicId: topic.id,
          title: topic.title,
          sourceCount: sources.length,
          focus: topic.focus,
          status:
            "已安排后台整理；此数量是检索范围的消息数，尚未筛选相关内容。纪要尚未完成，完成后会发送纪要或保存通知。",
        });
      },
    ),
    tool(
      "update_record",
      "更新已有文档。可用 scope 替换为全部历史、多个话题或任意支持的范围，用 focus 更改选材要求；省略时沿用原值。最新版本已保存且范围、要求未变时直接复用；另建文档使用 record。",
      object({
        topicId,
        scope: Type.Optional(sourceScope),
        focus: Type.Optional(Type.String()),
        directive,
      }),
      async (args) => {
        let topic = await getTopic(args.topicId);

        if (args.scope !== undefined || args.focus !== undefined) {
          const sources = args.scope
            ? await selectSources(store, message, args.scope)
            : undefined;

          if (sources?.length === 0) {
            return "这个范围内没有本地保存的群成员消息，原文档未改动。";
          }

          topic = await store.reviseRecording(topic.id, {
            ...(sources
              ? { messageIds: sources.map((source) => source.id) }
              : {}),
            ...(args.focus !== undefined ? { focus: args.focus } : {}),
          });
        }

        if (args.directive !== undefined) {
          await store.setDirective(topic.id, args.directive, message.id);
          topic = await getTopic(topic.id);
        }

        return arrange(topic, topic.directive === "send");
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

        const topic = await store.createRecording(message, {
          title: args.title || "连续讨论记录",
          messages: "following",
          directive: args.directive ?? "auto",
        });

        return `开始记录「${topic.title}」，编号 ${topic.id.slice(0, 8)}。聊完后 @ 我结束记录，我会整理纪要。`;
      },
    ),
    tool(
      "stop",
      "结束连续记录并整理。用户要求连同更早的内容一起整理时，用 include 指定来源范围，并入同一个话题。未指定 topicId 时选择请求者的连续记录。只有发起人或管理员可以结束。",
      object({
        topicId: Type.Optional(topicId),
        include: Type.Optional(sourceScope),
        directive,
      }),
      async (args) => {
        const owned = await store.manualTopics(message.groupId, message.userId);
        const topic = args.topicId ? await getTopic(args.topicId) : owned[0];

        if (topic?.mode !== "manual" || topic.state !== "active") {
          return "没有找到正在进行的手动记录。";
        }

        if (!isAdmin && topic.ownerId !== message.userId) {
          return "请记录的发起人或管理员结束这段记录。";
        }

        const included = args.include
          ? await selectSources(store, message, args.include)
          : [];

        if (args.directive !== undefined) {
          await store.setDirective(topic.id, args.directive, message.id);
        }

        const stopped = await store.stopRecording(
          topic.id,
          message.id,
          included.map((source) => source.id),
        );

        return `这段记录已结束。${await arrange(stopped, stopped.directive === "send")}`;
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
      "按标题、纪要内容或编号查找本群已有记录。没有纪要命中时，补充同一查询的聊天原文片段，便于直接 record。原文是字面搜索结果，不代表完整讨论；按范围语义整理用 record，查上下文用 read_history，发送纪要用 send。",
      object({
        query: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
      }),
      async ({ query }) => {
        const matches = await store.search(message.groupId, query.trim());

        return matches.length > 0
          ? JSON.stringify(
              matches.map(
                ({ id, title, description, focus, state, revision }) => ({
                  id,
                  title,
                  description,
                  focus,
                  state,
                  revision,
                }),
              ),
            )
          : JSON.stringify({
              records: [],
              historyMatches: await messageChunks(
                store,
                await store.searchMessages(
                  message.groupId,
                  query.trim(),
                  message.id - 1,
                ),
                Math.floor(config.AI_INPUT_CHARS / 4),
              ).then((pages) => pages[0] ?? []),
              hint: "没有已整理的纪要不代表没有讨论。这些只是原文字面匹配的片段；已有明确范围和目标时直接 record，不要求用户提供纪要 ID。",
            });
      },
    ),
    tool(
      "inspect",
      "查看本群某份记录的实际来源：原文数量、首尾消息片段和纪要版本。回答记录范围和内容时使用，不凭话题名称猜测。片段不是完整原文。",
      topicParameters,
      async ({ topicId }) => {
        const topic = await getTopic(topicId);
        const sources = await store.topicMessages(topic.id);
        const samples =
          sources.length > 1 ? [sources[0]!, sources.at(-1)!] : sources;

        return JSON.stringify({
          id: topic.id,
          title: topic.title,
          description: topic.description,
          focus: topic.focus,
          state: topic.state,
          revision: topic.revision,
          sourceCount: sources.length,
          needsUpdate: topic.generation !== topic.noteGeneration,
          tasks: await store.jobs.forTopic(topic.id),
          samples: samples.map((source) => ({
            id: `m${source.id}`,
            time: new Date(source.sentAt).toISOString(),
            author: source.displayName,
            excerpt: source.text.slice(0, 500),
            recalledAt: source.recalledAt,
          })),
        });
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
      "重试本群失败的后台识别、整理、附件和发送任务。不会重新执行旧的 @ 请求。需要管理员权限。",
      emptyParameters,
      async () => {
        if (!isAdmin) {
          return "只有群主、群管理员或配置中的管理员可以重试任务。";
        }

        const jobs = await store.jobs.retryFailed(message.groupId);
        const deliveries = await store.deliveries.retryFailed(message.groupId);

        return jobs + deliveries > 0
          ? `已重新安排本群 ${jobs} 个后台任务、${deliveries} 个发送任务。`
          : "没有待重试的后台或发送任务。若上次对话中断，请直接说明接下来要做什么。";
      },
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
