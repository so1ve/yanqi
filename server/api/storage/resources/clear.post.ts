import { resourceKinds } from "@yanqi/bot";
import { defineEventHandler } from "h3";
import { Type } from "typebox";

import { body, storeOperation } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { kind } = await body(
    event,
    Type.Object({
      kind: Type.Union(resourceKinds.map((kind) => Type.Literal(kind))),
    }),
  );

  return storeOperation(() => event.context.bot.clearResources(kind));
});
