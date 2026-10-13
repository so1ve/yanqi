import { defineNuxtRouteMiddleware, navigateTo, useNuxtApp } from "#imports";
import { api } from "~/utils/api";

export default defineNuxtRouteMiddleware(async (to, from) => {
  if (
    to.path === "/login" ||
    (!useNuxtApp().isHydrating && to.path === from.path)
  ) {
    return;
  }

  try {
    const session = await api<{ authenticated: boolean }>("session", {
      timeout: 5000,
    });

    if (session.authenticated) {
      return;
    }
  } catch {
    // 会话检查失败时，保留目标地址并回到登录页。
  }

  return navigateTo(
    { path: "/login", query: { redirect: to.fullPath } },
    { replace: true },
  );
});
