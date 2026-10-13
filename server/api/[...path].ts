import { createError, defineEventHandler } from "h3";

export default defineEventHandler(() => {
  throw createError({ statusCode: 404, message: "接口不存在" });
});
