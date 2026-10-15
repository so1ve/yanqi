import assert from "node:assert/strict";

import { Logger } from "@koishijs/core";
import type { OneBot } from "koishi-plugin-adapter-onebot";
import { Type } from "typebox";
import * as Value from "typebox/value";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { IncomingMessage, Message } from "../types.ts";
import { failureMessage } from "../utils/errors.ts";
import { beijingTime } from "../utils/time.ts";

const idSchema = Type.Union([
  Type.Integer(),
  Type.String({ pattern: "^-?\\d+$" }),
]);
const pageSchema = Type.Object({
  messages: Type.Array(
    Type.Object({
      group_id: idSchema,
      message_id: idSchema,
      user_id: idSchema,
      time: Type.Integer({ minimum: 0 }),
      sender: Type.Object({
        nickname: Type.String(),
        card: Type.Optional(Type.String()),
        role: Type.Optional(
          Type.Union([
            Type.Literal("owner"),
            Type.Literal("admin"),
            Type.Literal("member"),
          ]),
        ),
      }),
      message: Type.Array(
        Type.Object({
          type: Type.String(),
          data: Type.Record(Type.String(), Type.Unknown()),
        }),
      ),
    }),
  ),
});

// 启动和重连时补录一次。进度只在补录成功后推进，失败期间的新消息不能掩盖缺口。
export class HistorySync {
  #store: Store;
  #config: Config;
  #api: OneBot.Internal | null = null;
  #controller: AbortController | null = null;
  #pending: Promise<void> = Promise.resolve();
  #ready = new Set<string>();
  #logger = new Logger("yanqi:history");

  constructor(store: Store, config: Config) {
    this.#store = store;
    this.#config = config;
  }

  public connect(api: OneBot.Internal): void {
    if (this.#api === api) {
      return;
    }

    this.disconnect();
    this.#api = api;
    const controller = new AbortController();

    this.#controller = controller;
    const { GROUP_IDS, BOT_QQ, HISTORY_RETENTION_DAYS } = this.#config;
    const since =
      HISTORY_RETENTION_DAYS === 0
        ? 0
        : Date.now() - HISTORY_RETENTION_DAYS * 86_400_000;

    this.#pending = this.#pending.then(async () => {
      await Promise.all(
        GROUP_IDS.map(async (groupId) => {
          try {
            await this.#sync(api, groupId, BOT_QQ, since, controller.signal);
            controller.signal.throwIfAborted();
            this.#ready.add(groupId);
          } catch (error) {
            if (!controller.signal.aborted) {
              this.#logger.warn(
                "群 %s 历史消息补录失败，下次连接继续：%s",
                groupId,
                failureMessage(error),
              );
            }
          }
        }),
      );
    });
  }

  public disconnect(): void {
    this.#controller?.abort();
    this.#controller = null;
    this.#api = null;
    this.#ready.clear();
  }

  public async close(): Promise<void> {
    this.disconnect();
    await this.#pending;
  }

  public async received(message: Message): Promise<void> {
    if (this.#ready.has(message.groupId)) {
      await this.#store.groups.advanceHistory(message.groupId, message.sentAt);
    }
  }

  async #sync(
    api: OneBot.Internal,
    groupId: string,
    selfId: string,
    since: number,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const group = await this.#store.groups.find(groupId);

    assert.ok(group);
    // QQ 时间只有秒精度，重读边界这一秒，再由群号和消息 ID 去重。
    const from = Math.max(
      since,
      Math.floor(group.historyThrough / 1000) * 1000,
    );
    const pages: IncomingMessage[][] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let exhausted = false;

    this.#logger.info(
      "群 %s 开始补录历史消息：从 %s 起",
      groupId,
      beijingTime(from),
    );

    while (true) {
      const messages = await this.#page(api, groupId, selfId, cursor, signal);

      signal.throwIfAborted();
      if (messages.length === 0) {
        exhausted = true;

        break;
      }

      pages.push(messages.filter((message) => message.sentAt >= from));
      const first = messages[0]!;

      if (first.sentAt < from) {
        break;
      }

      if (first.messageId === cursor) {
        exhausted = true;

        break;
      }

      if (cursors.has(first.messageId)) {
        throw new Error("NapCat 返回重复历史分页，已停止补录，保留原进度");
      }

      cursor = first.messageId;
      cursors.add(cursor);
    }

    let added = 0;
    let through = group.historyThrough;

    // QQ 返回每页从旧到新；先写最早一页，重复的边界消息交给 Inbox 去重。
    for (const page of pages.reverse()) {
      for (const message of page) {
        signal.throwIfAborted();
        if (await this.#store.inbox.capture(message)) {
          added++;
        }

        through = Math.max(through, message.sentAt);
      }
    }

    signal.throwIfAborted();
    await this.#store.groups.advanceHistory(groupId, through);
    this.#logger.info(
      "群 %s 历史消息补录完成：新增 %s 条，读取 %s 页，最新 %s%s",
      groupId,
      added,
      pages.length,
      beijingTime(through),
      exhausted ? "；已到 NapCat 可读取的历史起点" : "",
    );
  }

  async #page(
    api: OneBot.Internal,
    groupId: string,
    selfId: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<IncomingMessage[]> {
    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(60_000),
    ]);

    requestSignal.throwIfAborted();
    let cancel = () => {};

    const aborted = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(requestSignal.reason);
      requestSignal.addEventListener("abort", cancel, { once: true });
    });

    try {
      const response = await Promise.race([
        api._request!("get_group_msg_history", {
          group_id: groupId,
          ...(cursor === undefined ? {} : { message_seq: cursor }),
          count: 100,
          reverse_order: true,
          parse_mult_msg: false,
          quick_reply: true,
        }),
        aborted,
      ]);
      const page: unknown = response.data;

      if (response.retcode !== 0) {
        throw new Error(`NapCat 历史消息请求失败：retcode=${response.retcode}`);
      }

      if (!Value.Check(pageSchema, page)) {
        throw new Error("NapCat 历史消息格式不正确，请使用 array 消息格式");
      }

      return page.messages.map((message) => {
        if (String(message.group_id) !== groupId) {
          throw new Error("NapCat 历史消息的群号不正确");
        }

        const reply = message.message.find(
          (segment) => segment.type === "reply",
        )?.data.id;

        return {
          groupId,
          messageId: String(message.message_id),
          userId: String(message.user_id),
          displayName: message.sender.card || message.sender.nickname,
          sentAt: message.time * 1000,
          receivedAt: Date.now(),
          text: message.message
            .filter((segment) => segment.type === "text")
            .map((segment) => String(segment.data.text ?? ""))
            .join(""),
          content: message.message,
          replyTo: reply === undefined ? null : String(reply),
          isBot: String(message.user_id) === selfId,
          addressed: message.message.some(
            (segment) =>
              segment.type === "at" && String(segment.data.qq) === selfId,
          ),
          role: message.sender.role ?? "member",
          historical: true,
        };
      });
    } finally {
      requestSignal.removeEventListener("abort", cancel);
    }
  }
}
