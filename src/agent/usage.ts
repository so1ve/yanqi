import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";

export class AiSizeError extends Error {}

export class BudgetExceeded extends Error {
  public nextRunAt: number;

  constructor(day: string) {
    super("今天的 AI 调用额度已用完，原始消息仍会保存");
    this.nextRunAt = Date.parse(`${day}T00:00:00+08:00`) + 86_400_000;
  }
}

export async function reserveCall(
  config: Config,
  store: Store,
  model: string,
  purpose: string,
): Promise<void> {
  const now = Date.now();
  const day = new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
  const allowed = await store.reserveCall(
    day,
    model,
    purpose,
    config.AI_DAILY_CALL_LIMIT,
    now,
  );

  if (!allowed) {
    throw new BudgetExceeded(day);
  }
}
