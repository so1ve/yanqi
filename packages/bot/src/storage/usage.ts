import type { Tables } from "@koishijs/core";
import { $ } from "@koishijs/core";

import type { Database } from "./schema.ts";

export class Usage {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public reserve(
    day: string,
    model: string,
    purpose: string,
    limit: number,
    now: number,
    details: Pick<Tables["usage"], "provider" | "account" | "groupId" | "task">,
  ): Promise<number | null> {
    return this.#db.transact(async (db) => {
      const calls = await db.eval("usage", (row) => $.count(row.id), { day });

      if (calls >= limit) {
        return null;
      }

      const call = await db.create("usage", {
        createdAt: now,
        day,
        model,
        purpose,
        ...details,
      });

      return call.id;
    });
  }

  public async record(
    calls: Pick<
      Tables["usage"],
      "id" | "input" | "output" | "cacheRead" | "cacheWrite" | "durationMs"
    >[],
  ): Promise<void> {
    if (calls.length > 0) {
      await this.#db.transact((db) => db.upsert("usage", calls));
    }
  }

  public async summary(groupId: string, day: string) {
    const calls = await this.#db.get("usage", { groupId, day });
    const totals = new Map<
      string,
      {
        provider: string;
        account: string;
        model: string;
        purpose: string;
        calls: number;
        measuredCalls: number;
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      }
    >();

    for (const call of calls) {
      const key = JSON.stringify([
        call.provider,
        call.account,
        call.model,
        call.purpose,
      ]);
      const total = totals.get(key) ?? {
        provider: call.provider,
        account: call.account,
        model: call.model,
        purpose: call.purpose,
        calls: 0,
        measuredCalls: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      };

      total.calls++;
      if (call.input !== null) {
        total.measuredCalls++;
        total.input += call.input;
        total.output += call.output ?? 0;
        total.cacheRead += call.cacheRead ?? 0;
        total.cacheWrite += call.cacheWrite ?? 0;
      }

      totals.set(key, total);
    }

    return {
      day,
      calls: calls.length,
      models: [...totals.values()],
      note: "token 合计只统计服务商已上报的用量，费用以服务商账单为准。account 表示使用的模型配置，不包含 API Key。",
    };
  }
}
