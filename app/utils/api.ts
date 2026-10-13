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

export const formatNumber = (value: number | undefined | null) =>
  value === undefined || value === null
    ? "—"
    : new Intl.NumberFormat("zh-CN").format(value);
export const formatTime = (time: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(time);
export const kindNames: Record<string, string> = {
  intent: "处理请求",
  observe: "识别记录请求",
  detect: "识别讨论",
  summarize: "整理纪要",
  asset: "解析附件",
  text: "文字回复",
  note: "纪要全文",
};
export const stateNames: Record<string, string> = {
  pending: "等待处理",
  running: "正在处理",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
  active: "记录中",
  closed: "已结束",
};
