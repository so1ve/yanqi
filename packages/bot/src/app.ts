import type { Context, ForkScope, Session } from "@koishijs/core";
import { Adapter, App, Logger } from "@koishijs/core";
import { HTTP } from "@koishijs/plugin-http";
import { OneBotBot } from "koishi-plugin-adapter-onebot";

import type { Config } from "./config.ts";
import { configurationError } from "./config.ts";
import { recallMessage, saveMessage } from "./onebot/message.ts";
import { ReactionSync } from "./onebot/reactions.ts";
import { Secretary } from "./secretary.ts";
import { StoreError } from "./storage/errors.ts";
import type { ResourceKind } from "./storage/resources.ts";
import type { Database } from "./storage/schema.ts";
import { Store } from "./storage/store.ts";

export class Yanqi {
  #app: App;
  #config: Config;
  #secretary: Secretary | null = null;
  #enabled: boolean;
  #connection: ForkScope | null = null;
  #listeners: (() => void)[] = [];
  #poll: (() => void) | null = null;
  #events = new Set<Promise<void>>();
  #operation: Promise<void> = Promise.resolve();
  public readonly store: Store;
  public readonly reactions: ReactionSync;
  #logger = new Logger("yanqi");

  private constructor(
    app: App,
    config: Config,
    directory: string,
    database: Database,
    autostart: boolean,
  ) {
    this.#app = app;
    this.#config = structuredClone(config);
    this.#enabled = autostart;
    this.store = new Store(database, directory, this.#config);

    const groups = app
      .platform("onebot")
      .intersect(
        (session) =>
          session.selfId === this.#config.BOT_QQ &&
          session.guildId !== undefined &&
          this.#config.GROUP_IDS.includes(session.guildId),
      );

    this.reactions = new ReactionSync(
      this.store,
      this.#config,
      () => this.napcat,
    );

    this.#listeners = [
      groups.on("notice", (session: Session) => {
        if (session.subtype === "group-msg-emoji-like") {
          return this.#track(() => this.reactions.receive(session)).catch(
            (error) => {
              this.#logger.warn("保存表情回应失败：%s", String(error));
            },
          );
        }
      }),
      groups.on("message", (session: Session) =>
        this.#track(async () => {
          const secretary = this.#secretary;
          const message = await saveMessage(session, this.store, this.#config);

          // 只处理接收时正在运行的对话，暂停或更换配置后不重放旧请求。
          if (message && secretary && secretary === this.#secretary) {
            await secretary.handleMessage(message);
          }
        }),
      ),
      groups.on("message-deleted", (session: Session) =>
        this.#track(() => recallMessage(session, this.store)),
      ),
      app.setInterval(() => {
        void this.purge().catch((error) =>
          this.#logger.warn("清理历史失败：%s", String(error)),
        );
      }, 3_600_000),
    ];
  }

  public static async open(
    config: Config,
    directory: string,
    database: Database,
    autostart = true,
  ): Promise<Yanqi> {
    const app = new App({
      nickname: ["言栖", "小栖"],
      autoAssign: false,
      autoAuthorize: 0,
    });

    app.plugin(HTTP, {});

    await app.start();

    const bot = new Yanqi(app, config, directory, database, autostart);

    await bot.store.jobs.recover();
    await bot.configure(config);
    void bot
      .purge()
      .catch((error) => bot.#logger.warn("清理历史失败：%s", String(error)));

    return bot;
  }

  public get config(): Readonly<Config> {
    return this.#config;
  }

  public get running(): boolean {
    return this.#secretary !== null;
  }

  public get online(): boolean {
    return this.#app.bots.some(
      (bot) => bot.selfId === this.#config.BOT_QQ && bot.status === 1,
    );
  }

  public get napcat() {
    const bot = this.#app.bots.find(
      (item) => item.selfId === this.#config.BOT_QQ && item.status === 1,
    ) as OneBotBot<Context> | undefined;

    if (!bot) {
      throw new Error(
        "NapCat 未连接，请检查 QQ 登录状态、WebSocket 地址和 OneBot Token",
      );
    }

    return bot.internal;
  }

  public configure(config: Config): Promise<void> {
    return this.#change(async () => {
      await this.#stop();
      await this.store.groups.ensure(config.GROUP_IDS);

      Object.assign(this.#config, structuredClone(config));
      this.#logger.level =
        config.LOG_LEVEL === "debug" ? Logger.DEBUG : Logger.INFO;
      if (config.BOT_QQ && config.ONEBOT_TOKEN) {
        const connection: OneBotBot.Config = {
          ...Adapter.WsClientConfig(),
          protocol: "ws",
          endpoint: config.ONEBOT_URL,
          selfId: config.BOT_QQ,
          token: config.ONEBOT_TOKEN,
          // 保留图文之间的原始空白，避免适配器自动插入空格。
          advanced: { splitMixedContent: false },
        };

        if (this.#connection) {
          this.#connection.update(connection);
        } else {
          this.#connection = this.#app.plugin(OneBotBot, connection);
        }
      } else {
        this.#connection?.dispose();
        this.#connection = null;
      }

      await this.#app.lifecycle.flush();
      if (this.#enabled) {
        const error = configurationError(config);

        if (error) {
          this.#logger.info("等待完善配置：%s", error);
        } else {
          this.#start();
        }
      }
    });
  }

  public start(): Promise<void> {
    return this.#change(() => {
      const error = configurationError(this.#config);

      if (error) {
        throw new Error(error);
      }

      this.#enabled = true;
      this.#start();
    });
  }

  public stop(): Promise<void> {
    return this.#change(async () => {
      this.#enabled = false;
      await this.#stop();
    });
  }

  public wake(): void {
    this.#secretary?.processPending();
  }

  public clearResources(kind: ResourceKind) {
    return this.#change(async () => {
      if (this.running) {
        throw new StoreError("conflict", "请先暂停 AI，再清理资源");
      }

      return this.store.resources.clear(kind);
    });
  }

  public purge() {
    return this.#change(async () => {
      const result = await this.store.purge(
        this.#config.HISTORY_RETENTION_DAYS,
      );

      this.#logger.info(
        "历史清理：消息=%s 附件=%s 文件=%s 释放文件字节=%s 忙碌群=%s",
        result.messages,
        result.assets,
        result.files,
        result.bytes,
        result.skippedGroups,
      );

      return result;
    });
  }

  public close(): Promise<void> {
    return this.#change(async () => {
      for (const dispose of this.#listeners) {
        dispose();
      }

      await this.#stop();
      await Promise.all(this.#events);
      await this.reactions.close();
      // OneBot 关闭时仍需要 Koishi 的共享服务。
      await Promise.all(this.#app.bots.map((bot) => bot.stop()));
      this.#connection?.dispose();
      this.#connection = null;
      await this.#app.lifecycle.flush();
      await this.#app.stop();
    });
  }

  #change<T>(action: () => T | Promise<T>): Promise<T> {
    const operation = this.#operation.then(action);

    this.#operation = operation.then(
      () => {},
      () => {},
    );

    return operation;
  }

  #track(action: () => Promise<void>): Promise<void> {
    const event = action().finally(() => {
      this.#events.delete(event);
    });

    this.#events.add(event);

    return event;
  }

  #start(): void {
    if (this.running) {
      return;
    }

    const secretary = new Secretary(
      this.#app,
      this.#config,
      this.store,
      this.reactions,
    );

    this.#secretary = secretary;
    this.#poll = this.#app.setInterval(() => {
      void this.#track(async () => {
        await secretary.checkTopics();
        secretary.processPending();
      }).catch((error) => this.#logger.warn("后台轮询失败：%s", String(error)));
    }, this.#config.WORK_INTERVAL_MS);
    secretary.processPending();
    this.#logger.info(
      "言栖已启动：groups=%s model=%s decision=%s",
      this.#config.GROUP_IDS.join(","),
      this.#config.AI_MODEL.model,
      this.#config.DECISION_PROVIDER,
    );
  }

  async #stop(): Promise<void> {
    const secretary = this.#secretary;

    if (!secretary) {
      return;
    }

    this.#secretary = null;
    this.#poll?.();
    this.#poll = null;
    await Promise.all([secretary.stop(), ...this.#events]);
    await this.store.jobs.cancelRequests("机器人已暂停，跳过旧对话");
    this.#logger.info("言栖已暂停 AI 处理，继续保存群消息");
  }
}
