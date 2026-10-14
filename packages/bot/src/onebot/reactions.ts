import { EventEmitter } from "node:events";

import type { Session } from "@koishijs/core";
import { Logger } from "@koishijs/core";
import type { OneBot } from "koishi-plugin-adapter-onebot";
import { Type } from "typebox";
import * as Value from "typebox/value";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { Message } from "../types.ts";
import { failureMessage } from "../utils/errors.ts";

declare module "@koishijs/core" {
  interface Events {
    notice: (session: Session) => void;
  }
}

const numericId = Type.String({ pattern: "^\\d+$" });
const groupIdSchema = Type.Union([Type.Integer(), numericId]);
const messageIdSchema = Type.Union([
  Type.Integer(),
  Type.String({ pattern: "^-?\\d+$" }),
]);
const historySchema = Type.Object({
  messages: Type.Array(
    Type.Object({
      group_id: groupIdSchema,
      message_id: messageIdSchema,
      time: Type.Number(),
    }),
  ),
});

class MissingMessageError extends Error {}

const noticeSchema = Type.Object({
  group_id: groupIdSchema,
  message_id: messageIdSchema,
  likes: Type.Array(Type.Object({ emoji_id: numericId })),
  is_add: Type.Optional(Type.Boolean()),
});
const messageSchema = Type.Object({
  group_id: groupIdSchema,
  emoji_likes_list: Type.Array(
    Type.Object({ emoji_id: numericId, emoji_type: numericId }),
  ),
});
const pageSchema = Type.Object({
  result: Type.Literal(0),
  emojiLikesList: Type.Array(Type.Object({ tinyId: numericId })),
  cookie: Type.String(),
  isLastPage: Type.Boolean(),
});

interface ReactionUpdate {
  messageId: number;
  reactions: Awaited<ReturnType<Store["reactions"]["forMessages"]>>;
}

export class ReactionSync {
  #store: Store;
  #config: Config;
  #api: () => OneBot.Internal;
  #pending = new Map<number, Promise<void>>();
  #events = new EventEmitter<{
    change: [groupId: string, update: ReactionUpdate];
  }>();

  #logger = new Logger("yanqi:reactions");

  constructor(store: Store, config: Config, api: () => OneBot.Internal) {
    this.#store = store;
    this.#config = config;
    this.#api = api;
  }

  public subscribe(
    groupId: string,
    receive: (update: ReactionUpdate) => void,
  ): () => void {
    function listener(group: string, update: ReactionUpdate) {
      if (group === groupId) {
        receive(update);
      }
    }

    this.#events.on("change", listener);

    return () => {
      this.#events.off("change", listener);
    };
  }

  public async receive(session: Session): Promise<void> {
    const raw: unknown = session.onebot;

    if (!Value.Check(noticeSchema, raw)) {
      throw new Error("NapCat 表情回应通知格式不正确");
    }

    const groupId = String(raw.group_id);

    if (groupId !== session.guildId) {
      throw new Error("表情回应群号与会话不一致");
    }

    this.#logger.info(
      "收到表情回应：group=%s qqMessage=%s 操作=%s 表情=%s",
      groupId,
      raw.message_id,
      raw.is_add === false ? "取消" : "添加",
      raw.likes.map((like) => like.emoji_id).join(","),
    );
    const message = await this.#store.messages.quoted(
      groupId,
      String(raw.message_id),
    );

    if (!message) {
      this.#logger.debug(
        "回应对应的原文未保存：group=%s qqMessage=%s",
        groupId,
        raw.message_id,
      );

      return;
    }

    // 通知只说明变更，读取当前完整状态；不按原文作者或交互权限筛选。
    await this.#enqueue(
      message,
      raw.likes.map((like) => like.emoji_id),
    );
  }

  public async refresh(messages: Message[]): Promise<number> {
    const failures = new Map<Message, unknown>();

    await this.#readMessages(messages, failures);

    const missing = Map.groupBy(
      [...failures]
        .filter(([, error]) => error instanceof MissingMessageError)
        .map(([message]) => message),
      (message) => message.groupId,
    );

    for (const [groupId, sources] of missing) {
      try {
        // NapCat 的短消息 ID 索引只在内存中；历史查询会重新建立索引。
        const restored = await this.#restoreIndex(groupId, sources);
        const available = sources.filter((message) =>
          restored.has(message.messageId),
        );

        await this.#readMessages(available, failures);
      } catch (error) {
        for (const message of sources) {
          failures.set(message, error);
        }
      }
    }

    const first = failures.entries().next().value;

    if (first) {
      this.#logger.warn(
        "%s/%s 条消息的表情回应未能刷新，保留已保存状态：m%s: %s",
        failures.size,
        messages.length,
        first[0].id,
        failureMessage(first[1]),
      );
    }

    return failures.size;
  }

  async #readMessages(
    messages: Message[],
    failures: Map<Message, unknown>,
  ): Promise<void> {
    // 按需补读所查看的消息，不定时扫描群历史，也不为回应唤醒对话。
    for (let start = 0; start < messages.length; start += 4) {
      await Promise.all(
        messages.slice(start, start + 4).map(async (message) => {
          try {
            await this.#enqueue(message);
            failures.delete(message);
          } catch (error) {
            failures.set(message, error);
          }
        }),
      );
    }
  }

  async #restoreIndex(
    groupId: string,
    messages: Message[],
  ): Promise<Set<string>> {
    const wanted = new Set(messages.map((message) => message.messageId));
    const restored = new Set<string>();
    const oldest = Math.min(...messages.map((message) => message.sentAt));
    const api = this.#api();
    const seen = new Set<string>();
    let cursor = "0";

    while (wanted.size > 0) {
      const response = await api._request!("get_group_msg_history", {
        group_id: groupId,
        message_seq: cursor,
        count: 100,
        parse_mult_msg: false,
        disable_get_url: true,
        quick_reply: true,
      });
      const page: unknown = response.data;

      if (response.retcode !== 0 || !Value.Check(historySchema, page)) {
        throw new Error(`NapCat 无法恢复群 ${groupId} 的历史消息索引`);
      }

      if (
        page.messages.some((message) => String(message.group_id) !== groupId)
      ) {
        throw new Error("NapCat 历史消息的群号不正确");
      }

      if (page.messages.length === 0) {
        break;
      }

      for (const message of page.messages) {
        const id = String(message.message_id);

        if (wanted.delete(id)) {
          restored.add(id);
        }
      }

      const first = page.messages.reduce((a, b) => (a.time <= b.time ? a : b));
      const next = String(first.message_id);

      if (first.time * 1000 < oldest || next === cursor || seen.has(next)) {
        break;
      }

      seen.add(next);
      cursor = next;
    }

    this.#logger.info(
      "群 %s 历史消息索引已恢复：%s/%s 条",
      groupId,
      restored.size,
      messages.length,
    );

    return restored;
  }

  public async close(): Promise<void> {
    await Promise.allSettled(this.#pending.values());
  }

  #enqueue(message: Message, changedEmojiIds?: string[]): Promise<void> {
    const previous = this.#pending.get(message.id);

    if (previous && !changedEmojiIds) {
      return previous;
    }

    // 通知排在正在进行的补读之后，取消回应不会被旧请求覆盖。
    const pending = (previous ? previous.catch(() => {}) : Promise.resolve())
      .then(() => this.#read(message, changedEmojiIds ?? []))
      .finally(() => {
        if (this.#pending.get(message.id) === pending) {
          this.#pending.delete(message.id);
        }
      });

    this.#pending.set(message.id, pending);

    return pending;
  }

  async #read(message: Message, changedEmojiIds: string[]) {
    const api = this.#api();

    if (!api._request) {
      throw new Error("NapCat 未连接，无法读取表情回应");
    }

    const response = await api._request("get_msg", {
      message_id: message.messageId,
    });
    const detail: unknown = response.data;

    if (response.retcode !== 0) {
      const ErrorType = response.retcode === 1200 ? MissingMessageError : Error;

      throw new ErrorType(
        `NapCat 无法读取消息 ${message.messageId}（${response.retcode}）`,
      );
    }

    if (
      !Value.Check(messageSchema, detail) ||
      String(detail.group_id) !== message.groupId
    ) {
      throw new Error(`消息 ${message.messageId} 的表情回应格式或群号不正确`);
    }

    const emojis = new Map(
      detail.emoji_likes_list.map((emoji) => [
        emoji.emoji_id,
        emoji.emoji_type,
      ]),
    );

    for (const id of changedEmojiIds) {
      // NapCat 通知不带类型，沿用其 ID 约定；详情中的类型优先。
      if (!emojis.has(id)) {
        emojis.set(id, id.length > 3 ? "2" : "1");
      }
    }

    const reactions = [];

    for (const [emojiId, emojiType] of emojis) {
      const users: string[] = [];
      const seen = new Set<string>();
      let cookie = "";

      while (true) {
        const response = await api._request("fetch_emoji_like", {
          message_id: message.messageId,
          emojiId,
          emojiType,
          count: 20,
          cookie,
        });
        const page: unknown = response.data;

        if (response.retcode !== 0 || !Value.Check(pageSchema, page)) {
          throw new Error(
            `读取群 ${message.groupId} 消息 ${message.messageId} 的表情 ${emojiId} 失败`,
          );
        }

        users.push(...page.emojiLikesList.map((user) => user.tinyId));
        if (page.isLastPage) {
          break;
        }

        if (!page.cookie || seen.has(page.cookie)) {
          throw new Error("NapCat 表情回应分页未前进");
        }

        seen.add(page.cookie);
        cookie = page.cookie;
      }

      reactions.push({ emojiId, emojiType, users });
    }

    // 所有分页成功后再替换，缺失的表情会移除；失败不能把已知回应清空。
    if (
      await this.#store.reactions.replace(
        message.id,
        reactions,
        this.#config.BOT_QQ,
      )
    ) {
      const current = await this.#store.reactions.forMessages([message.id]);

      this.#logger.info(
        "表情回应已更新：group=%s m%s %s",
        message.groupId,
        message.id,
        current
          .map((item) => `${item.name}=${item.count} 小栖=${item.botCount}`)
          .join("，") || "已清空",
      );
      this.#events.emit("change", message.groupId, {
        messageId: message.id,
        reactions: current,
      });
    }
  }
}
