import { APIError } from "openai";

export function failureMessage(error: unknown): string {
  if (error instanceof APIError) {
    return `AI 服务请求失败（HTTP ${error.status ?? "未知"}，${error.name}）`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "发生了未知错误";
}
