import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestURL,
  setResponseHeaders,
} from "h3";

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);

  if (!url.pathname.startsWith("/api/")) {
    return;
  }

  setResponseHeaders(event, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
  });
  if (!["GET", "HEAD"].includes(event.method)) {
    const origin = getRequestHeader(event, "origin");

    if (origin && origin !== (process.env.WEB_ORIGIN ?? url.origin)) {
      throw createError({ statusCode: 403, message: "请求来源不受信任" });
    }
  }

  if (url.pathname === "/api/session" || url.pathname === "/api/login") {
    return;
  }

  if (!(await event.context.auth.loggedIn(event))) {
    throw createError({ statusCode: 401, message: "请先登录管理台" });
  }
});
