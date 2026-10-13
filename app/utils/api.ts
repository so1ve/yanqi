import { $fetch, FetchError } from "ofetch";

export const api = $fetch.create({
  baseURL: "/api",
  credentials: "same-origin",
  retry: 0,
  timeout: 120_000,
});

export function errorText(error: unknown): string {
  if (error instanceof FetchError && typeof error.data?.message === "string") {
    return error.data.message;
  }

  if (error instanceof FetchError && !error.response) {
    return "无法连接管理台，请检查网络和言栖服务。";
  }

  return error instanceof Error ? error.message : "操作失败";
}
