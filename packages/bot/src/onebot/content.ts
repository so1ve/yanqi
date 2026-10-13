import { CQCode } from "koishi-plugin-adapter-onebot";

import type { Asset, Segment } from "../types.ts";
import { failureMessage } from "../utils/errors.ts";

export function attachmentReference(
  segment: Segment,
): Pick<Asset, "kind" | "reference"> | null {
  const kind = segment.type === "record" ? "audio" : segment.type;

  if (
    kind !== "audio" &&
    kind !== "file" &&
    kind !== "forward" &&
    kind !== "image" &&
    kind !== "video"
  ) {
    return null;
  }

  const reference = String(
    segment.data.url ||
      segment.data.id ||
      segment.data.file_id ||
      segment.data.file ||
      "",
  );

  return reference ? { kind, reference } : null;
}

export interface ForwardMessage {
  sender: { user_id: string; nickname: string };
  time: number;
  content: Segment[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// NapCat 返回 message 数组；OneBot 的转发节点也支持 content 和 CQ 字符串。
export function forwardMessages(value: unknown): ForwardMessage[] {
  if (!Array.isArray(value)) {
    throw new TypeError("合并转发没有返回消息列表");
  }

  return value.map((node) => {
    if (!isObject(node)) {
      throw new Error("合并转发包含无效的消息节点");
    }

    const body = node.message ?? node.content;
    const content: unknown =
      typeof body === "string"
        ? CQCode.parse(body).map(({ type, attrs }) => ({
            type,
            data: type === "text" ? { text: attrs.content } : attrs,
          }))
        : body;

    if (
      !Array.isArray(content) ||
      !content.every(
        (segment) =>
          isObject(segment) &&
          typeof segment.type === "string" &&
          isObject(segment.data),
      )
    ) {
      throw new Error("合并转发包含无效的消息内容");
    }

    const sender = isObject(node.sender) ? node.sender : {};
    const userId = String(sender.user_id ?? node.user_id ?? "");
    const time = Number(node.time);

    return {
      sender: {
        user_id: userId,
        nickname: String(
          sender.card ||
            sender.nickname ||
            node.nickname ||
            userId ||
            "未知发送者",
        ),
      },
      time: Number.isFinite(time) ? time : 0,
      content: (content as Segment[]).map(({ type, data }) => ({
        type,
        data: { ...data },
      })),
    };
  });
}

export function* forwardAttachments(
  messages: ForwardMessage[],
): Generator<Segment> {
  for (const message of messages) {
    for (const segment of message.content) {
      if (segment.type === "forward") {
        if (Array.isArray(segment.data.content)) {
          yield* forwardAttachments(forwardMessages(segment.data.content));
        }
      } else if (attachmentReference(segment)) {
        yield segment;
      }
    }
  }
}

export async function expandForward(
  reference: string,
  cached: unknown | undefined,
  fetchForward: (reference: string) => Promise<unknown>,
  maxBytes: number,
  signal: AbortSignal,
) {
  const fetched = new Map<string, Promise<unknown>>();
  const errors = new Set<string>();
  let bytes = 0;
  let expandedBytes = 0;

  function accept(value: unknown): unknown {
    bytes += Buffer.byteLength(JSON.stringify(value) ?? "");
    if (bytes > maxBytes) {
      throw new Error("合并转发超过附件大小限制");
    }

    return value;
  }

  function fetch(id: string): Promise<unknown> {
    let result = fetched.get(id);

    if (!result) {
      result = fetchForward(id).then(accept);
      fetched.set(id, result);
    }

    return result;
  }

  async function expand(
    value: unknown,
    ancestors: string[],
    depth: number,
  ): Promise<ForwardMessage[]> {
    signal.throwIfAborted();
    if (depth > 16) {
      throw new Error("嵌套转发超过 16 层，停止展开");
    }

    const messages = forwardMessages(value);

    for (const message of messages) {
      // 重复引用的卡片只请求一次，但展开后的每一份内容都计入大小限制。
      expandedBytes += Buffer.byteLength(
        JSON.stringify({
          ...message,
          content: message.content.map((segment) =>
            segment.type === "forward"
              ? { type: "forward", data: { id: segment.data.id } }
              : segment,
          ),
        }),
      );
      if (expandedBytes > maxBytes) {
        throw new Error("合并转发展开后超过附件大小限制");
      }

      for (const segment of message.content) {
        if (segment.type !== "forward") {
          continue;
        }

        const id = String(segment.data.id ?? "");

        try {
          if (id && ancestors.includes(id)) {
            throw new Error("转发卡片循环引用，停止展开");
          }

          if (!Array.isArray(segment.data.content) && !id) {
            throw new Error("嵌套转发缺少内容和转发编号");
          }

          const content = await expand(
            Array.isArray(segment.data.content)
              ? segment.data.content
              : await fetch(id),
            id ? [...ancestors, id] : ancestors,
            depth + 1,
          );

          segment.data = { id, content };
        } catch (error) {
          signal.throwIfAborted();
          const reason = failureMessage(error);

          errors.add(reason);
          segment.data = { id, error: reason };
        }
      }
    }

    return messages;
  }

  const messages = await expand(
    cached === undefined ? await fetch(reference) : accept(cached),
    [reference],
    0,
  );

  return { messages, errors: [...errors] };
}
