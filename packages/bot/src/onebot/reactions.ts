import type { Session } from "@koishijs/core";
import type { OneBot } from "koishi-plugin-adapter-onebot";
import { Type } from "typebox";
import * as Value from "typebox/value";

import type { Store } from "../storage/store.ts";

declare module "@koishijs/core" {
  interface Events {
    notice: (session: Session) => void;
  }
}

const noticeSchema = Type.Object({
  group_id: Type.Union([Type.Integer(), Type.String({ pattern: "^\\d+$" })]),
  message_id: Type.Union([
    Type.Integer(),
    Type.String({ pattern: "^-?\\d+$" }),
  ]),
  likes: Type.Array(
    Type.Object({ emoji_id: Type.String({ pattern: "^\\d+$" }) }),
  ),
});
const pageSchema = Type.Object({
  result: Type.Literal(0),
  emojiLikesList: Type.Array(
    Type.Object({ tinyId: Type.String({ pattern: "^\\d+$" }) }),
  ),
  cookie: Type.String(),
  isLastPage: Type.Boolean(),
});

export class ReactionSync {
  #store: Store;
  #api: () => OneBot.Internal;
  #pending = new Map<string, Promise<void>>();

  constructor(store: Store, api: () => OneBot.Internal) {
    this.#store = store;
    this.#api = api;
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

    const messageId = String(raw.message_id);

    for (const emojiId of new Set(raw.likes.map((like) => like.emoji_id))) {
      const key = `${groupId}:${messageId}:${emojiId}`;
      // 同一回应顺序读取，避免旧请求晚返回覆盖取消后的状态。
      const previous = this.#pending.get(key);
      const pending = (
        previous ? previous.catch(() => {}) : Promise.resolve()
      ).then(() => this.#read(groupId, messageId, emojiId, session.selfId));

      this.#pending.set(key, pending);
      try {
        await pending;
      } finally {
        if (this.#pending.get(key) === pending) {
          this.#pending.delete(key);
        }
      }
    }
  }

  async #read(
    groupId: string,
    messageId: string,
    emojiId: string,
    botId: string,
  ) {
    const message = await this.#store.messages.quoted(groupId, messageId);

    if (!message) {
      return;
    }

    // NapCat 按 ID 长度区分 QQ 系统表情与 Unicode 表情。
    const emojiType = emojiId.length > 3 ? "2" : "1";
    const users: string[] = [];
    const seen = new Set<string>();
    let cookie = "";
    const api = this.#api();

    if (!api._request) {
      throw new Error("NapCat 未连接，无法读取表情回应");
    }

    while (true) {
      const response = await api._request("fetch_emoji_like", {
        message_id: messageId,
        emojiId,
        emojiType,
        count: 20,
        cookie,
      });
      const page: unknown = response.data;

      if (response.retcode !== 0 || !Value.Check(pageSchema, page)) {
        throw new Error(
          `读取群 ${groupId} 消息 ${messageId} 的表情 ${emojiId} 失败`,
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

    await this.#store.reactions.replace(
      message.id,
      emojiType,
      emojiId,
      users,
      botId,
    );
  }
}
