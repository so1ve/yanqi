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
const noticeSchema = Type.Object({
  group_id: groupIdSchema,
  message_id: Type.Union([
    Type.Integer(),
    Type.String({ pattern: "^-?\\d+$" }),
  ]),
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
    let failed = 0;
    let firstError = "";

    // 按需补读所查看的消息，不定时扫描群历史，也不为回应唤醒对话。
    for (let start = 0; start < messages.length; start += 4) {
      await Promise.all(
        messages.slice(start, start + 4).map(async (message) => {
          try {
            await this.#enqueue(message);
          } catch (error) {
            failed++;
            firstError ||= `m${message.id}: ${failureMessage(error)}`;
          }
        }),
      );
    }

    if (failed > 0) {
      this.#logger.warn(
        "%s/%s 条消息的表情回应未能刷新，保留已保存状态：%s",
        failed,
        messages.length,
        firstError,
      );
    }

    return failed;
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
      throw new Error(
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
