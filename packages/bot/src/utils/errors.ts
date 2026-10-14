import { APIError } from "openai";

export class AiError extends Error {
  constructor(
    public readonly stage: string,
    detail: string,
    options?: ErrorOptions,
  ) {
    super(`${stage}失败：${detail}`, options);
  }
}

// 模型已用尽纠正机会或调用轮数，后台不得丢掉反馈再原样重跑。
export class AiProtocolError extends AiError {}

export function failureMessage(error: unknown): string {
  if (error instanceof APIError) {
    return `AI 服务请求失败（HTTP ${error.status ?? "未知"}，${error.name}）`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "发生了未知错误";
}
