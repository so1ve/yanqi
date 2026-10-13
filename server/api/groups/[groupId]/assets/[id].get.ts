import { extname } from "node:path";

import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
} from "h3";

import { readDataFile } from "~~/server/files";
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

  const bytes = await readDataFile(bot.store.directory, asset.path);

  setResponseHeader(event, "Content-Type", "application/octet-stream");
  setResponseHeader(
    event,
    "Content-Disposition",
    `attachment; filename="asset-${id}${extname(asset.path)}"`,
  );

  return bytes;
});
