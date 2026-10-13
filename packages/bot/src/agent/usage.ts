import type { Config, ModelConfig } from "../config.ts";
import type { Store } from "../storage/store.ts";
import { logContext } from "../utils/logging.ts";
import { beijingDate } from "../utils/time.ts";

export class AiSizeError extends Error {}

export class BudgetExceeded extends Error {
  public nextRunAt: number;

  constructor(day: string) {
    super("已达到今天的 AI 调用次数上限，原始消息仍会保存。");
    this.nextRunAt = Date.parse(`${day}T00:00:00+08:00`) + 86_400_000;
  }
}

export async function reserveCall(
  config: Config,
  store: Store,
  model: ModelConfig,
  purpose: string,
): Promise<number> {
  const now = Date.now();
  const day = beijingDate(now);
  const context = logContext.getStore();
  const account =
    Object.entries(config).find(
      ([key, value]) =>
        key.endsWith("_MODEL") &&
        typeof value === "object" &&
        value !== null &&
        "apiKey" in value &&
        value.apiKey === model.apiKey &&
        value.baseURL === model.baseURL,
    )?.[0] ?? "DECISION_API_KEY";
  const id = await store.usage.reserve(
    day,
    model.model,
    purpose,
    config.AI_DAILY_CALL_LIMIT,
    now,
    {
      provider: new URL(model.baseURL).origin,
      account,
      groupId: context?.groupId ?? null,
      task: context?.task ?? null,
    },
  );

  if (id === null) {
    throw new BudgetExceeded(day);
  }

  return id;
}
