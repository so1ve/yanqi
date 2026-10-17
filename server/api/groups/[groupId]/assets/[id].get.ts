import { extname } from "node:path";

import { audioMimeType, imageMimeType } from "@yanqi/bot";
import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
} from "h3";

import { readDataFile } from "~~/server/files";
import {
  groupParam,
  integer,
  queryParam,
  requireItem,
} from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  const id = integer(getRouterParam(event, "id"));
  const asset = requireItem(await bot.store.assets.find(groupId, id));

  if (asset.state === "missing") {
    throw createError({ statusCode: 410, message: "原件已清理" });
  }

  if (!asset.path) {
    throw createError({ statusCode: 404, message: "附件尚未下载" });
  }

  const bytes = await readDataFile(bot.store.directory, asset.path);
  const mime =
    imageMimeType(asset.path) ||
    audioMimeType(asset.path) ||
    (extname(asset.path) === ".mp4" ? "video/mp4" : undefined);
  const preview = queryParam(event, "preview") === "1" && Boolean(mime);

  setResponseHeader(event, "Cache-Control", "private, no-cache");

  setResponseHeader(event, "Content-Type", mime || "application/octet-stream");
  setResponseHeader(
    event,
    "Content-Disposition",
    `${preview ? "inline" : "attachment"}; filename="asset-${id}${extname(asset.path)}"`,
  );

  return bytes;
});
