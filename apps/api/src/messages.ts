import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { Yanqi } from "@yanqi/bot";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { $ } from "koishi";

import { integer, pagination, requireItem, search } from "./http.ts";

export function registerMessages(app: Hono, bot: Yanqi): void {
  app.get("/api/groups/:groupId/messages", async (ctx) => {
    const { page, limit, offset } = pagination(ctx);
    const pattern = search(ctx);
    const groupId = ctx.req.param("groupId");
    const query = { groupId, ...(pattern ? { text: pattern } : {}) };
    const [items, total] = await Promise.all([
      bot.database.get("messages", query, {
        sort: { id: "desc" },
        limit,
        offset,
        fields: [
          "id",
          "groupId",
          "messageId",
          "userId",
          "displayName",
          "sentAt",
          "text",
          "isBot",
          "addressed",
          "recalledAt",
          "replyTo",
        ],
      }),
      bot.database.eval("messages", (row) => $.count(row.id), query),
    ]);
    const attachments = await bot.database.get("assets", {
      messageId: items.map((item) => item.id),
    });

    return ctx.json({
      items: items.map((item) => ({
        ...item,
        assets: attachments
          .filter((asset) => asset.messageId === item.id)
          .map(({ path, reference, ...asset }) => ({
            ...asset,
            downloadable: Boolean(path),
            reference,
          })),
      })),
      total,
      page,
      limit,
    });
  });
  app.get("/api/groups/:groupId/assets/:id", async (ctx) => {
    const id = integer(ctx.req.param("id"));
    const asset = requireItem((await bot.database.get("assets", id))[0]);

    requireItem(
      (
        await bot.database.get("messages", {
          id: asset.messageId,
          groupId: ctx.req.param("groupId"),
        })
      )[0],
    );
    if (!asset.path) {
      throw new HTTPException(404, { message: "附件尚未下载" });
    }

    const path = resolve(asset.path);

    if (!path.startsWith(`${resolve(bot.config.DATA_DIR)}${sep}`)) {
      throw new HTTPException(400, { message: "附件不在当前数据目录中" });
    }

    const bytes = await readFile(path);

    ctx.header("Content-Type", "application/octet-stream");
    ctx.header(
      "Content-Disposition",
      `attachment; filename="asset-${id}${path.slice(path.lastIndexOf("."))}"`,
    );

    return ctx.body(bytes);
  });
  app.post("/api/groups/:groupId/assets/:id/retry", async (ctx) => {
    const asset = requireItem(
      (await bot.database.get("assets", integer(ctx.req.param("id"))))[0],
    );
    const groupId = ctx.req.param("groupId");

    requireItem(
      (await bot.database.get("messages", { id: asset.messageId, groupId }))[0],
    );
    const job = await bot.store.jobs.forAsset(asset.id);

    if (job.state === "running" || job.state === "pending") {
      throw new HTTPException(409, { message: "附件已经在处理中" });
    }

    await bot.store.jobs.restart(groupId, job.id);
    bot.wake();

    return ctx.json({ taskId: job.id });
  });
}
