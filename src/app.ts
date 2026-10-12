import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { HTTP } from "@koishijs/plugin-http";
import { Adapter, App, Logger } from "koishi";
import { OneBotBot } from "koishi-plugin-adapter-onebot";

import type { Config } from "./config.ts";
import { Secretary } from "./secretary.ts";
import { defineModels } from "./storage/schema.ts";
import { SQLite } from "./storage/sqlite.ts";
import { Store } from "./storage/store.ts";
import { failureMessage } from "./utils/errors.ts";
import { logDetail } from "./utils/logging.ts";

export async function startApplication(config: Config): Promise<App> {
  const logger = new Logger("yanqi");

  logger.level = config.LOG_LEVEL === "debug" ? Logger.DEBUG : Logger.INFO;
  Logger.targets[0]!.showTime = "yyyy-MM-dd hh:mm:ss";

  const app = new App({
    nickname: ["言栖", "小栖"],
    autoAssign: false,
    autoAuthorize: 0,
  });

  await mkdir(config.DATA_DIR, { recursive: true });
  app.plugin(SQLite, { path: join(config.DATA_DIR, "yanqi.sqlite") });
  defineModels(app.model);

  await app.start();

  const store = new Store(app.database, config.DATA_DIR);

  await store.initialize(config.GROUP_IDS);
  const secretary = new Secretary(app, config, store);
  const groups = app
    .platform("onebot")
    .self(config.BOT_QQ)
    .guild(...config.GROUP_IDS);

  groups.on("message", (session) => secretary.handleMessage(session));
  groups.on("message-deleted", (session) => secretary.handleRecall(session));
  app.setInterval(async () => {
    try {
      await secretary.checkTopics();
      secretary.processPending();
    } catch (error) {
      logger.warn("后台轮询失败：%s", logDetail(failureMessage(error), config));
      logger.debug("后台轮询异常：%s", logDetail(error, config));
    }
  }, config.WORK_INTERVAL_MS);

  app.plugin(HTTP, {});
  app.plugin(OneBotBot, {
    ...Adapter.WsClientConfig(),
    protocol: "ws",
    endpoint: config.ONEBOT_URL,
    selfId: config.BOT_QQ,
    token: config.ONEBOT_TOKEN,
    // 保留图文之间的原始空白，避免适配器自动插入空格。
    advanced: { splitMixedContent: false },
  });

  await app.lifecycle.flush();

  logger.info(
    "言栖已启动：groups=%s log=%s model=%s decision=%s",
    config.GROUP_IDS.join(","),
    config.LOG_LEVEL,
    config.AI_MODEL.model,
    config.DECISION_PROVIDER,
  );

  return app;
}
