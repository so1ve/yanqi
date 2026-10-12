import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { HTTP } from "@koishijs/plugin-http";
import { Adapter, App } from "koishi";
import { OneBotBot } from "koishi-plugin-adapter-onebot";

import type { Config } from "./config.ts";
import { Secretary } from "./secretary.ts";
import { defineModels } from "./storage/schema.ts";
import { SQLite } from "./storage/sqlite.ts";
import { Store } from "./storage/store.ts";
import { failureMessage } from "./utils/errors.ts";

export async function startApplication(config: Config): Promise<App> {
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
  const logger = app.logger("yanqi");
  const groups = app
    .platform("onebot")
    .self(config.BOT_QQ)
    .guild(...config.GROUP_IDS)
    .exclude((session) => session.isDirect);

  groups.on("message", (session) => secretary.handleMessage(session));
  groups.on("message-deleted", (session) => secretary.handleRecall(session));
  app.setInterval(async () => {
    try {
      await secretary.checkTopics();
      await secretary.processPending();
    } catch (error) {
      logger.warn(failureMessage(error));
    }
  }, config.WORK_INTERVAL_MS);

  app.plugin(HTTP, {});
  app.plugin(OneBotBot, {
    ...Adapter.WsClientConfig(),
    protocol: "ws",
    endpoint: config.ONEBOT_URL,
    selfId: config.BOT_QQ,
    token: config.ONEBOT_TOKEN,
    advanced: { splitMixedContent: false },
  });

  await app.lifecycle.flush();

  logger.info("言栖已启动，已配置 %s 个记录群。", config.GROUP_IDS.length);

  return app;
}
