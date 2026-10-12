import type { Yanqi } from "@yanqi/bot";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { $ } from "koishi";

import { integer, pagination, requireItem } from "./http.ts";

export function registerTasks(app: Hono, bot: Yanqi): void {
  app.get("/api/groups/:groupId/tasks", async (ctx) => {
    const { page, limit, offset } = pagination(ctx);
    const state = ctx.req.query("state");

    if (state && !["done", "failed", "pending", "running"].includes(state)) {
      throw new HTTPException(400, { message: "任务状态无效" });
    }

    const query = {
      "payload.groupId": ctx.req.param("groupId"),
      ...(state
        ? { state: state as "pending" | "running" | "done" | "failed" }
        : {}),
    };
    const [items, total] = await Promise.all([
      bot.database.get("jobs", query, { sort: { id: "desc" }, offset, limit }),
      bot.database.eval("jobs", (row) => $.count(row.id), query),
    ]);

    return ctx.json({ items, total, page, limit });
  });
  app.post("/api/groups/:groupId/tasks/:id/retry", async (ctx) => {
    const groupId = ctx.req.param("groupId");
    const id = integer(ctx.req.param("id"));
    const job = await bot.store.jobs.get(groupId, id);

    if (job.kind === "intent" || job.kind === "observe") {
      throw new HTTPException(409, {
        message: "旧对话不能重放，请在群里重新发起请求",
      });
    }

    if (job.state === "running" || job.state === "pending") {
      throw new HTTPException(409, { message: "任务已经在队列中" });
    }

    await bot.store.jobs.restart(groupId, id);
    bot.wake();

    return ctx.json({ ok: true });
  });
  app.post("/api/groups/:groupId/tasks/:id/cancel", async (ctx) => {
    const groupId = ctx.req.param("groupId");
    const id = integer(ctx.req.param("id"));

    await bot.database.transact(async (db) => {
      const job = requireItem(
        (await db.get("jobs", { id, "payload.groupId": groupId }))[0],
      );

      if (job.state === "running") {
        throw new HTTPException(409, {
          message: "任务正在执行。需要中断时，请先停止机器人",
        });
      }

      if (job.kind === "detect" && "messageIds" in job.payload) {
        const through = Math.max(0, ...job.payload.messageIds);

        await db.set("groups", { id: groupId }, (row) => ({
          cursor: $.if($.gt(through, row.cursor), through, row.cursor),
        }));
      }

      await db.set(
        "jobs",
        { id },
        { state: "done", lastError: "管理员取消", progress: "已取消" },
      );
    });

    return ctx.json({ ok: true });
  });
  app.get("/api/groups/:groupId/deliveries", async (ctx) => {
    const { page, limit, offset } = pagination(ctx);
    const query = { groupId: ctx.req.param("groupId") };
    const [items, total] = await Promise.all([
      bot.database.get("deliveries", query, {
        sort: { id: "desc" },
        offset,
        limit,
      }),
      bot.database.eval("deliveries", (row) => $.count(row.id), query),
    ]);

    return ctx.json({ items, total, page, limit });
  });
  app.post("/api/groups/:groupId/deliveries/:id/cancel", async (ctx) => {
    const id = integer(ctx.req.param("id"));
    const delivery = requireItem(
      (
        await bot.database.get("deliveries", {
          id,
          groupId: ctx.req.param("groupId"),
        })
      )[0],
    );

    if (bot.running) {
      throw new HTTPException(409, {
        message: "请先停止机器人，避免取消时消息已经发出",
      });
    }

    if (delivery.state !== "pending") {
      throw new HTTPException(409, { message: "只能取消尚未发送的消息" });
    }

    await bot.store.deliveries.cancel(id);

    return ctx.json({ ok: true });
  });
}
