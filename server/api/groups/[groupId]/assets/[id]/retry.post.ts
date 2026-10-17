import { audioMimeType } from "@yanqi/bot";
import { createError, defineEventHandler, getRouterParam } from "h3";

import {
  groupParam,
  integer,
  requireItem,
  storeOperation,
} from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);
  const id = integer(getRouterParam(event, "id"));
  const asset = requireItem(await bot.store.assets.find(groupId, id));

  if (
    asset.path &&
    asset.state !== "missing" &&
    (asset.kind === "image" || asset.path?.includes("/assets/images/")) &&
    !bot.config.AI_VISION_MODEL
  ) {
    throw createError({ statusCode: 409, message: "请先配置图片识别模型" });
  }

  if (
    asset.path &&
    asset.state !== "missing" &&
    asset.kind === "audio" &&
    audioMimeType(asset.path) &&
    !bot.config.AI_AUDIO_MODEL
  ) {
    throw createError({
      statusCode: 409,
      message: "语音已可播放；如需转写，请先配置语音转写模型",
    });
  }

  const taskId = await storeOperation(() =>
    bot.store.assets.retry(groupId, id),
  );

  bot.wake();

  return { taskId };
});
