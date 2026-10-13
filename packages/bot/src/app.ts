import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Context, ForkScope, Session } from "@koishijs/core";
import { Adapter, App, Logger } from "@koishijs/core";
import { HTTP } from "@koishijs/plugin-http";
import { OneBotBot } from "koishi-plugin-adapter-onebot";

import type { Config } from "./config.ts";
import { configurationError } from "./config.ts";
import { recallMessage, saveMessage } from "./onebot/message.ts";
import { Secretary } from "./secretary.ts";
import { defineModels } from "./storage/schema.ts";
import { SQLite } from "./storage/sqlite.ts";
import { Store } from "./storage/store.ts";

export class Yanqi {
  #app: App;
  #config: Config;
  #directory: string;
  #secretary: Secretary | null = null;
  #enabled: boolean;
  #connection: ForkScope | null = null;
  #listeners: (() => void)[] = [];
  #poll: (() => void) | null = null;
  #events = new Set<Promise<void>>();
  #operation: Promise<void> = Promise.resolve();
  #store: Store;
  #logger = new Logger("yanqi");

  private constructor(
    app: App,
    config: Config,
    directory: string,
    autostart: boolean,
  ) {
    this.#app = app;
    this.#config = config;
    this.#directory = directory;
    this.#enabled = autostart;
    this.#store = this.#createStore();

    const groups = app
      .platform("onebot")
      .intersect(
        (session) =>
          session.selfId === this.#config.BOT_QQ &&
          this.#config.GROUP_IDS.includes(session.guildId),
      );

    this.#listeners = [
      groups.on("message", (session: Session) =>
        this.#track(async () => {
          const secretary = this.#secretary;
          const message = await saveMessage(session, this.#store, this.#config);

          // 只处理接收时正在运行的对话，暂停或更换配置后不重放旧请求。
          if (message && secretary && secretary === this.#secretary) {
            await secretary.handleMessage(message);
          }
        }),
      ),
      groups.on("message-deleted", (session: Session) =>
        this.#track(() => recallMessage(session, this.#store)),
      ),
    ];
  }

  public static async open(
    config: Config,
    directory: string,
    autostart = true,
  ): Promise<Yanqi> {
    await mkdir(directory, { recursive: true });

    const app = new App({
      nickname: ["言栖", "小栖"],
      autoAssign: false,
      autoAuthorize: 0,
    });

    app.plugin(SQLite, { path: join(directory, "yanqi.sqlite") });
    defineModels(app.model);
    app.plugin(HTTP, {});

    await app.start();

    const bot = new Yanqi(app, config, directory, autostart);

    await bot.store.initialize();
    await bot.configure(config);

    return bot;
  }

  public get store(): Store {
    return this.#store;
  }

  public get database() {
    return this.#app.database;
  }

  public get config(): Config {
    return structuredClone(this.#config);
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
      const reconnect =
        !this.#connection ||
        config.BOT_QQ !== this.#config.BOT_QQ ||
        config.ONEBOT_URL !== this.#config.ONEBOT_URL ||
        config.ONEBOT_TOKEN !== this.#config.ONEBOT_TOKEN;

      if (reconnect) {
        this.#connection?.dispose();
        this.#connection = null;
        await this.#app.lifecycle.flush();
      }

      await this.database.upsert(
        "groups",
        config.GROUP_IDS.map((id) => ({ id })),
      );
      this.#config = structuredClone(config);
      this.#store = this.#createStore();
      this.#logger.level =
        config.LOG_LEVEL === "debug" ? Logger.DEBUG : Logger.INFO;
      if (reconnect && config.BOT_QQ && config.ONEBOT_TOKEN) {
        this.#connection = this.#app.plugin(OneBotBot, {
          ...Adapter.WsClientConfig(),
          protocol: "ws",
          endpoint: config.ONEBOT_URL,
          selfId: config.BOT_QQ,
          token: config.ONEBOT_TOKEN,
          // 保留图文之间的原始空白，避免适配器自动插入空格。
          advanced: { splitMixedContent: false },
        });
        await this.#app.lifecycle.flush();
      }

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
    return this.#change(async () => {
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

  public close(): Promise<void> {
    return this.#change(async () => {
      for (const dispose of this.#listeners) {
        dispose();
      }

      await this.#stop();
      await Promise.all(this.#events);
      // OneBot 关闭时仍需要 Koishi 的共享服务。
      await Promise.all(this.#app.bots.map((bot) => bot.stop()));
      this.#connection?.dispose();
      this.#connection = null;
      await this.#app.lifecycle.flush();
      await this.#app.stop();
    });
  }

  #change(action: () => Promise<void>): Promise<void> {
    const operation = this.#operation.then(action);

    this.#operation = operation.catch(() => {});

    return operation;
  }

  #createStore(): Store {
    return new Store(
      this.#app.database,
      this.#directory,
      this.#config.ADMIN_IDS,
      this.#config.GROUP_ADMINS,
    );
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

    const secretary = new Secretary(this.#app, this.#config, this.#store);

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
    await this.database.set(
      "jobs",
      { state: "pending", $or: [{ kind: "intent" }, { kind: "observe" }] },
      { state: "failed", lastError: "机器人已暂停，跳过旧对话" },
    );
    await this.database.set(
      "messages",
      { awaitingReply: true },
      { awaitingReply: false },
    );
    this.#logger.info("言栖已暂停 AI 处理，继续保存群消息");
  }
}
