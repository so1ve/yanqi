import { AsyncLocalStorage } from "node:async_hooks";
import { inspect } from "node:util";

import type { Config } from "../config.ts";

export const logContext = new AsyncLocalStorage<{
  task: string;
  groupId: string;
  requestId?: number;
}>();

export function logDetail(value: unknown, config: Config): string {
  let text =
    value instanceof Error
      ? [
          value.stack || value.message,
          value.cause instanceof Error
            ? `原因：${value.cause.stack || value.cause.message}`
            : value.cause,
        ]
          .filter(Boolean)
          .join("\n")
      : typeof value === "string"
        ? value
        : inspect(value, {
            depth: 5,
            maxArrayLength: 30,
            maxStringLength: null,
            breakLength: Infinity,
          });

  for (const secret of [
    config.AI_MODEL.apiKey,
    config.AI_DETECT_MODEL?.apiKey,
    config.AI_INTENT_MODEL?.apiKey,
    config.AI_REPLY_MODEL?.apiKey,
    config.AI_VISION_MODEL?.apiKey,
    config.AI_AUDIO_MODEL?.apiKey,
    config.DECISION_API_KEY,
    config.ONEBOT_TOKEN,
  ]) {
    if (secret) {
      text = text.replaceAll(secret, "[已隐藏]");
    }
  }

  return text.length > 2000
    ? `${text.slice(0, 2000)}…（共 ${text.length} 字符，已截断）`
    : text;
}
