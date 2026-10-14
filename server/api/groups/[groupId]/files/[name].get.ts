import { assetFileName, imageMimeType } from "@yanqi/bot";
import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
} from "h3";

import { readDataFile } from "~~/server/files";
import { groupParam, queryParam, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const name = getRouterParam(event, "name")!;

  if (!assetFileName.test(name)) {
    throw createError({ statusCode: 400, message: "附件名称无效" });
  }

  const asset = requireItem(
    await bot.store.assets.file(groupParam(event), name),
  );
  const path = asset.path!;
  const preview = queryParam(event, "preview") === "1" && imageMimeType(path);

  setResponseHeader(
    event,
    "Content-Type",
    preview || "application/octet-stream",
  );
  setResponseHeader(
    event,
    "Content-Disposition",
    `${preview ? "inline" : "attachment"}; filename="${name}"`,
  );

  return readDataFile(bot.store.directory, path);
});
