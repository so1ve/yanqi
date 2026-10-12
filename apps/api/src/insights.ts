import type { Yanqi } from "@yanqi/bot";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { $ } from "koishi";
import { Type } from "typebox";

import { body, pagination, search } from "./http.ts";

export function registerInsights(app: Hono, bot: Yanqi): void {
  app.get("/api/overview", async (ctx) => {
    const db = bot.database;
    const day = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
    }).format(Date.now());
    const [messages, records, pending, failed, calls, recent, tasks] =
      await Promise.all([
        db.eval("messages", (row) => $.count(row.id), { isBot: false }),
        db.eval("topics", (row) => $.count(row.id), { revision: { $gt: 0 } }),
        db.eval("jobs", (row) => $.count(row.id), {
          $or: [{ state: "pending" }, { state: "running" }],
        }),
        db.eval("jobs", (row) => $.count(row.id), {
          state: "failed",
          $not: { $or: [{ kind: "intent" }, { kind: "observe" }] },
        }),
        db.eval("usage", (row) => $.count(row.id), { day }),
        db.get("topics", {}, { sort: { lastActiveAt: "desc" }, limit: 6 }),
        db.get(
          "jobs",
          { $or: [{ state: "pending" }, { state: "running" }] },
          { sort: { id: "desc" }, limit: 6 },
        ),
      ]);

    return ctx.json({
      messages,
      records,
      pending,
      failed,
      calls,
      recent,
      tasks,
      day,
      dailyLimit: bot.config.AI_DAILY_CALL_LIMIT,
    });
  });
  app.get("/api/groups/:groupId/usage", async (ctx) => {
    const day =
      ctx.req.query("day") ??
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
        Date.now(),
      );

    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new HTTPException(400, { message: "日期需要 YYYY-MM-DD 格式" });
    }

    return ctx.json(
      await bot.store.usage.summary(ctx.req.param("groupId"), day),
    );
  });
  app.get("/api/groups/:groupId/memories", async (ctx) => {
    const { page, limit, offset } = pagination(ctx);
    const pattern = search(ctx);
    const query = {
      groupId: ctx.req.param("groupId"),
      ...(pattern
        ? { $or: [{ content: pattern }, { key: pattern }, { userId: pattern }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      bot.database.get("memories", query, {
        sort: { updatedAt: "desc" },
        offset,
        limit,
      }),
      bot.database.eval("memories", (row) => $.count(row.key), query),
    ]);

    return ctx.json({ items, total, page, limit });
  });
  app.put("/api/groups/:groupId/memories", async (ctx) => {
    const input = await body(
      ctx,
      Type.Object({
        userId: Type.String({ pattern: "^\\d+$" }),
        key: Type.String({ minLength: 1, maxLength: 100 }),
        content: Type.String({ minLength: 1, maxLength: 4000 }),
      }),
    );
    const groupId = ctx.req.param("groupId");

    await bot.database.upsert("groups", [{ id: groupId }]);
    await bot.database.upsert("memories", [
      { ...input, groupId, sourceMessageId: null, updatedAt: Date.now() },
    ]);

    return ctx.json({ ok: true });
  });
  app.delete("/api/groups/:groupId/memories", async (ctx) => {
    const input = await body(
      ctx,
      Type.Object({
        userId: Type.String({ pattern: "^\\d+$" }),
        key: Type.String({ minLength: 1, maxLength: 100 }),
      }),
    );

    await bot.database.remove("memories", {
      ...input,
      groupId: ctx.req.param("groupId"),
    });

    return ctx.json({ ok: true });
  });
}
