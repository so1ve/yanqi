import { serve } from "@hono/node-server";
import { Yanqi, readConfig } from "@yanqi/bot";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { Logger } from "koishi";

import { registerAuth } from "./auth.ts";
import { ControlStore } from "./control.ts";
import { registerGroups } from "./groups.ts";
import { registerInsights } from "./insights.ts";
import { LogBuffer } from "./logs.ts";
import { registerMessages } from "./messages.ts";
import { registerRecords } from "./records.ts";
import { registerSettings } from "./settings.ts";
import { registerTasks } from "./tasks.ts";

async function main(): Promise<void> {
  const initial = readConfig();
  const control = await ControlStore.open(initial.DATA_DIR, initial);
  const saved = await control.settings();
  const bot = await Yanqi.open({ ...saved.config, DATA_DIR: initial.DATA_DIR });
  const logs = new LogBuffer(() => bot.config);
  const logger = new Logger("yanqi:api");
  const app = new Hono();
  const origin = process.env.WEB_ORIGIN;

  app.use("*", secureHeaders(), bodyLimit({ maxSize: 5 * 1024 * 1024 }));
  app.use("/api/*", async (ctx, next) => {
    ctx.header("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(ctx.req.method)) {
      const requestedOrigin = ctx.req.header("origin");

      if (
        requestedOrigin &&
        requestedOrigin !== (origin ?? new URL(ctx.req.url).origin)
      ) {
        throw new HTTPException(403, { message: "请求来源不受信任" });
      }
    }

    await next();
  });
  app.get("/health", (ctx) => ctx.json({ ok: true }));
  await registerAuth(app, control, origin);
  registerSettings(app, bot, control);
  registerGroups(app, bot, control);
  registerRecords(app, bot);
  registerMessages(app, bot);
  registerTasks(app, bot);
  registerInsights(app, bot);
  app.get("/api/status", (ctx) =>
    ctx.json({
      running: bot.running,
      connected: bot.online,
      groups: bot.config.GROUP_IDS,
      model: bot.config.AI_MODEL.model,
      decision: bot.config.DECISION_PROVIDER,
    }),
  );
  app.post("/api/bot/start", async (ctx) => {
    await bot.start();

    return ctx.json({ running: true });
  });
  app.post("/api/bot/stop", async (ctx) => {
    await bot.stop();

    return ctx.json({ running: false });
  });
  app.get("/api/logs", (ctx) =>
    ctx.json(logs.read(Number(ctx.req.query("after")) || 0)),
  );
  app.onError((error, ctx) => {
    if (error instanceof HTTPException) {
      return ctx.json({ error: error.message }, error.status);
    }

    logger.warn(
      "请求 %s %s 失败：%s",
      ctx.req.method,
      ctx.req.path,
      String(error),
    );

    return ctx.json({ error: "操作失败，请查看运行日志中的具体原因" }, 500);
  });
  app.notFound((ctx) => ctx.json({ error: "接口不存在" }, 404));

  if (saved.autostart) {
    try {
      await bot.start();
    } catch (error) {
      logger.warn("自动启动失败：%s", String(error));
    }
  }

  const server = serve({
    fetch: app.fetch,
    hostname: process.env.API_HOST ?? "127.0.0.1",
    port: Number(process.env.API_PORT ?? 3100),
  });

  logger.info(
    "管理 API 已启动：http://%s:%s",
    process.env.API_HOST ?? "127.0.0.1",
    process.env.API_PORT ?? 3100,
  );
  function close() {
    server.close();
    void bot
      .close()
      .then(() => control.close())
      .catch(console.error);
  }

  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
