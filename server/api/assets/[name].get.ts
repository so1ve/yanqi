import { join } from "node:path";

import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
} from "h3";

import { readDataFile } from "~~/server/files";
import { requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const name = getRouterParam(event, "name")!;

  if (!/^[a-f0-9]{64}\.[a-z]+$/.test(name)) {
    throw createError({ statusCode: 400, message: "附件名称无效" });
  }

  const path = join(bot.store.directory, "assets", name);

  requireItem(
    (
      await bot.database.get("assets", { path }, { fields: ["id"], limit: 1 })
    )[0],
  );
  const bytes = await readDataFile(bot.store.directory, path);

  setResponseHeader(event, "Content-Type", "application/octet-stream");
  setResponseHeader(
    event,
    "Content-Disposition",
    `attachment; filename="${name}"`,
  );

  return bytes;
});
