import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
} from "h3";

export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, "userId")!;

  if (!/^\d+$/.test(userId)) {
    throw createError({ statusCode: 400, message: "QQ 号只能包含数字" });
  }

  const avatar = await event.context.avatars.get(userId);

  setResponseHeader(event, "Content-Type", avatar.contentType);

  return Buffer.from(avatar.data);
});
