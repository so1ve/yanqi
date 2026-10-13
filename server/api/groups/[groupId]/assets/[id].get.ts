import { extname } from "node:path";

import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
} from "h3";

import { imageMimeType, readDataFile } from "~~/server/files";
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
  const asset = requireItem(
    await bot.database
      .selectFrom("assets")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst(),
  );

  requireItem(
    await bot.database
      .selectFrom("messages")
      .select("id")
      .where("id", "=", asset.messageId)
      .where("groupId", "=", groupId)
      .executeTakeFirst(),
  );
  if (!asset.path) {
    throw createError({ statusCode: 404, message: "附件尚未下载" });
  }

  const bytes = await readDataFile(bot.store.directory, asset.path);
  const preview =
    queryParam(event, "preview") === "1" && imageMimeType(asset.path);

  setResponseHeader(
    event,
    "Content-Type",
    preview || "application/octet-stream",
  );
  setResponseHeader(
    event,
    "Content-Disposition",
    `${preview ? "inline" : "attachment"}; filename="asset-${id}${extname(asset.path)}"`,
  );

  return bytes;
});
