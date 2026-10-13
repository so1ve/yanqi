import { defineNuxtRouteMiddleware, navigateTo } from "#imports";
import { api } from "~/utils/api";

export default defineNuxtRouteMiddleware(async (to, from) => {
  if (
    to.path === "/login" ||
    (to.path === from.path && from.matched.length > 0)
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
  } catch {}

  return navigateTo(
    { path: "/login", query: { redirect: to.fullPath } },
    { replace: true },
  );
});
