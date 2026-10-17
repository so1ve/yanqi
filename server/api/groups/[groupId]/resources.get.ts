import type { Asset } from "@yanqi/bot";
import { createError, defineEventHandler } from "h3";

import { groupParam, integer, queryParam, search } from "~~/server/utils/http";

export default defineEventHandler((event) => {
  const before = queryParam(event, "before");
  const kind = queryParam(event, "kind");

  if (
    kind !== undefined &&
    !["audio", "file", "forward", "image", "video"].includes(kind)
  ) {
    throw createError({ statusCode: 400, message: "资源类型无效" });
  }

  return event.context.bot.store.assets.list(
    groupParam(event),
    search(event),
    before === undefined ? undefined : integer(before),
    kind as Asset["kind"] | undefined,
  );
});
