import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Context, ForkScope, Session } from "@koishijs/core";
import { Adapter, App, Logger } from "@koishijs/core";
import { HTTP } from "@koishijs/plugin-http";
import { OneBotBot } from "koishi-plugin-adapter-onebot";

import type { Config } from "./config.ts";
import { assertConfigured } from "./config.ts";
import { Secretary } from "./secretary.ts";
import { defineModels } from "./storage/schema.ts";
import { SQLite } from "./storage/sqlite.ts";
import { Store } from "./storage/store.ts";

export class Yanqi {
  #app: App;
  #config: Config;
  #directory: string;
  #secretary: Secretary | null = null;
  #connection: ForkScope | null = null;
  #listeners: (() => void)[] = [];
  #events = new Set<Promise<void>>();
  #operation: Promise<void> = Promise.resolve();
  #store: Store;
  #logger = new Logger("yanqi");

  private constructor(app: App, config: Config, directory: string) {
    this.#app = app;
    this.#config = config;
    this.#directory = directory;
    this.#store = this.#createStore();
  }

  public static async open(config: Config, directory: string): Promise<Yanqi> {
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

    const bot = new Yanqi(app, config, directory);

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
      throw new Error("NapCat 尚未连接，请检查账号、地址和令牌");
    }

    return bot.internal;
  }

  public configure(config: Config): Promise<void> {
    return this.#change(async () => {
      const running = this.running;

      if (running) {
        assertConfigured(config);
      }

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

      if (running) {
        await this.#start();
      }
    });
  }

  public start(): Promise<void> {
    return this.#change(() => this.#start());
  }

  public stop(): Promise<void> {
    return this.#change(() => this.#stop());
  }

  public wake(): void {
    this.#secretary?.processPending();
  }

  public close(): Promise<void> {
    return this.#change(async () => {
      await this.#stop();
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

  async #start(): Promise<void> {
    if (this.running) {
      return;
    }

    assertConfigured(this.#config);
    await this.#store.initialize(this.#config.GROUP_IDS);
    const secretary = new Secretary(this.#app, this.#config, this.#store);
    const groups = this.#app
      .platform("onebot")
      .self(this.#config.BOT_QQ)
      .guild(...this.#config.GROUP_IDS);

    this.#secretary = secretary;
    this.#listeners = [
      groups.on("message", (session: Session) =>
        this.#track(() => secretary.handleMessage(session)),
      ),
      groups.on("message-deleted", (session: Session) =>
        this.#track(() => secretary.handleRecall(session)),
      ),
      this.#app.setInterval(() => {
        void this.#track(async () => {
          await secretary.checkTopics();
          secretary.processPending();
        }).catch((error) =>
          this.#logger.warn("后台轮询失败：%s", String(error)),
        );
      }, this.#config.WORK_INTERVAL_MS),
    ];
    secretary.processPending();
    this.#logger.info(
      "言栖已启动：groups=%s model=%s decision=%s",
      this.#config.GROUP_IDS.join(","),
      this.#config.AI_MODEL.model,
      this.#config.DECISION_PROVIDER,
    );
  }

  async #stop(): Promise<void> {
    if (!this.#secretary) {
      return;
    }

    for (const dispose of this.#listeners) {
      dispose();
    }

    this.#listeners = [];
    await Promise.all([this.#secretary.stop(), ...this.#events]);
    await this.database.set(
      "jobs",
      { state: "pending", $or: [{ kind: "intent" }, { kind: "observe" }] },
      { state: "failed", lastError: "管理员停止了机器人，跳过旧对话" },
    );
    this.#secretary = null;
    this.#logger.info("言栖已停止处理消息");
  }
}
