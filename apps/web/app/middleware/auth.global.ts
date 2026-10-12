import { defineNuxtRouteMiddleware, navigateTo } from "#imports";
import { api } from "~/utils/api";

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === "/login") {
    return;
  }

  try {
    const session = await api<{ authenticated: boolean }>("session", {
      timeout: 5000,
    });

    if (!session.authenticated) {
      return navigateTo("/login");
    }
  } catch {
    return navigateTo("/login");
  }
});
