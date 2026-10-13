import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
} from "h3";

import { groupParam, integer, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const id = integer(getRouterParam(event, "id"));
  const asset = requireItem((await bot.database.get("assets", id))[0]);

  requireItem(
    (
      await bot.database.get("messages", {
        id: asset.messageId,
        groupId,
      })
    )[0],
  );
  if (!asset.path) {
    throw createError({ statusCode: 404, message: "附件尚未下载" });
  }

  const path = resolve(asset.path);

  if (!path.startsWith(`${resolve(bot.store.directory)}${sep}`)) {
    throw createError({ statusCode: 400, message: "附件不在当前数据目录中" });
  }

  const bytes = await readFile(path);

  setResponseHeader(event, "Content-Type", "application/octet-stream");
  setResponseHeader(
    event,
    "Content-Disposition",
    `attachment; filename="asset-${id}${path.slice(path.lastIndexOf("."))}"`,
  );

  return bytes;
});
