import type { Static } from "typebox";
import { Type } from "typebox";

import { messageChunks } from "../../recording/messages.ts";
import {
  selectSources,
  sourceId,
  sourceScope,
} from "../../recording/sources.ts";
import type { HistoryAvailability } from "../../storage/messages.ts";
import type { ChatMessage } from "../../types.ts";
import { beijingTime } from "../../utils/time.ts";
import type { ReadContext } from "./context.ts";
import { getTopic, object, revision, tool, topicId } from "./context.ts";

const chatParameters = Type.Union([
  object({
    action: Type.Literal("context"),
    beforeId: Type.Optional(sourceId),
  }),
  object({ action: Type.Literal("messages"), scope: sourceScope }),
  object({
    action: Type.Literal("search"),
    query: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
  }),
]);
const noteParameters = object({ topicId, revision });

export interface HistoryMetadata {
  handle: string;
  selection:
    | Static<typeof chatParameters>
    | ({ action: "note" } & Static<typeof noteParameters>);
  textChars: number;
  sourceCount?: number;
  attachmentCount?: number;
  availableHistory?: HistoryAvailability;
  range?: {
    fromMessageId: string;
    throughMessageId: string;
    from: string;
    through: string;
  } | null;
  nextBeforeId?: string | null;
  title?: string;
  revision?: number;
}

type Page = { messages: ChatMessage[] } | { markdown: string };
type OnMetadata = (metadata: HistoryMetadata) => void;

function historyReader(context: ReadContext, onMetadata: OnMetadata) {
  const reads = new Map<string, () => Promise<Page[]>>();

  return {
    register(
      info: Omit<HistoryMetadata, "handle">,
      load: () => Promise<Page[]>,
    ): HistoryMetadata {
      const handle = `h${reads.size + 1}`;
      let pages: Page[] | undefined;

      reads.set(handle, async () => (pages ??= await load()));

      const metadata = { handle, ...info };

      onMetadata(metadata);

      return metadata;
    },
    read: tool(
      context,
      "read_history",
      "用元数据查询返回的句柄读取正文。不能直接传 scope、消息 ID 或话题 ID。page 从 0 开始，nextPage 非空时用同一 handle 继续。句柄只属于当前助手，固定本次查询的范围或版本，不需要每页重新查询。",
      object({
        handle: Type.String({ minLength: 1 }),
        page: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      async ({ handle, page = 0 }) => {
        const load = reads.get(handle);

        if (!load) {
          throw new Error("本次查阅没有这个句柄，请先查询元数据");
        }

        const pages = await load();

        if (page >= Math.max(1, pages.length)) {
          throw new Error(`页码超出范围，共 ${pages.length} 页，页码从 0 开始`);
        }

        return {
          handle,
          page,
          totalPages: pages.length,
          nextPage: page + 1 < pages.length ? page + 1 : null,
          ...(pages[page] ?? { messages: [] }),
        };
      },
    ),
  };
}

export function chatHistoryTools(context: ReadContext, onMetadata: OnMetadata) {
  const { store, message, config } = context;
  const history = historyReader(context, onMetadata);

  return [
    tool(
      context,
      "history",
      "先查询本群聊天的元数据，不返回正文。context 查询 beforeId 之前最近 40 条对话，省略时从请求前开始；messages 按 scope 查询；search 字面搜索聊天，均包含成员和言栖的发言。返回句柄、消息数、文本字符数、附件数和时间范围。availableHistory 是本群请求前全部可读历史的数量和时间边界，不代表入群时间；textChars 不含附件解析内容，搜索统计只覆盖命中消息。元数据会立即转交小栖，需要正文时用 read_history 携带句柄读取。",
      chatParameters,
      async (args) => {
        const sources =
          args.action === "messages"
            ? await selectSources(store, message, args.scope, {
                includeBot: true,
              })
            : await store.messages.listMetadata(
                message.groupId,
                args.action === "context" && args.beforeId
                  ? Math.min(Number(args.beforeId.slice(1)), message.id) - 1
                  : message.id - 1,
                args.action === "context"
                  ? { includeBot: true, limit: 40 }
                  : { query: args.query.trim(), includeBot: true },
              );
        const first = sources[0];
        const last = sources.at(-1);
        const earlier =
          args.action === "context" && first
            ? await store.messages.listMetadata(message.groupId, first.id - 1, {
                includeBot: true,
                limit: 1,
              })
            : [];

        return history.register(
          {
            selection: args,
            availableHistory: await store.messages.availableHistory(
              message.groupId,
              message.id,
            ),
            sourceCount: sources.length,
            textChars: sources.reduce((sum, item) => sum + item.textChars, 0),
            attachmentCount: sources.reduce(
              (sum, item) => sum + item.attachmentCount,
              0,
            ),
            range:
              first && last
                ? {
                    fromMessageId: `m${first.id}`,
                    throughMessageId: `m${last.id}`,
                    from: beijingTime(first.sentAt),
                    through: beijingTime(last.sentAt),
                  }
                : null,
            ...(args.action === "context"
              ? { nextBeforeId: earlier.length > 0 ? `m${first!.id}` : null }
              : {}),
          },
          async () =>
            (
              await messageChunks(
                store,
                await store.messages.getMany(
                  sources.map((source) => source.id),
                ),
                Math.floor(config.AI_INPUT_CHARS / 4),
              )
            ).map((messages) => ({ messages })),
        );
      },
    ),
    history.read,
  ];
}

export function noteHistoryTools(context: ReadContext, onMetadata: OnMetadata) {
  const { store, config } = context;
  const history = historyReader(context, onMetadata);

  return [
    tool(
      context,
      "note",
      "查询本群纪要指定版本的标题、版本号、字符数和正文句柄，省略 revision 选最新版。不加载正文；元数据立即转交小栖。需要正文时用 read_history 携带句柄读取。",
      noteParameters,
      async (args) => {
        const topic = await getTopic(context, args.topicId);
        const note = await store.notes.metadata(topic.id, args.revision);

        if (!note) {
          throw new Error(`「${topic.title}」尚无所请求的已保存版本`);
        }

        return history.register(
          {
            selection: { action: "note", ...args },
            title: topic.title,
            revision: note.revision,
            textChars: note.textChars,
          },
          async () => {
            const { markdown } = await store.notes.get(note.id);
            const size = Math.floor(config.AI_INPUT_CHARS / 4);

            return Array.from(
              { length: Math.max(1, Math.ceil(markdown.length / size)) },
              (_, page) => ({
                markdown: markdown.slice(page * size, (page + 1) * size),
              }),
            );
          },
        );
      },
    ),
    history.read,
  ];
}
