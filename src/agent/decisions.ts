import { Logger } from "koishi";
import OpenAI from "openai";
import { Type } from "typebox";
import * as Value from "typebox/value";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import { failureMessage } from "../utils/errors.ts";
import { logContext, logDetail } from "../utils/logging.ts";
import { BudgetExceeded, reserveCall } from "./usage.ts";

const clefResponse = Type.Object({
  success: Type.Literal(true),
  result: Type.Unknown(),
});
const decisionResponse = Type.Object({
  answers: Type.Record(Type.String(), Type.Unknown()),
});
const choiceSchema = Type.Object({
  type: Type.Literal("choice"),
  choice: Type.String(),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});

export class DecisionProvider {
  #config: Config;
  #store: Store;
  #logger = new Logger("yanqi:ai");
  #client: OpenAI | null;

  constructor(config: Config, store: Store) {
    this.#config = config;
    this.#store = store;
    this.#client =
      config.DECISION_PROVIDER === "openai" ||
      config.DECISION_PROVIDER === "vercel"
        ? new OpenAI({
            apiKey: config.DECISION_API_KEY,
            baseURL: config.DECISION_URL,
            timeout: config.AI_TIMEOUT_MS,
            maxRetries: 0,
          })
        : null;
  }

  async #evaluate(
    input: string,
    instructions: string,
    criteria: Record<string, string>,
  ): Promise<unknown> {
    if (this.#client) {
      const result = await this.#client.decisions.create({
        model: this.#config.DECISION_MODEL,
        input,
        questions: [
          {
            type: "choice",
            name: "action",
            instructions,
            choices: Object.entries(criteria).map(([value, description]) => ({
              value,
              description,
            })),
          },
        ],
      });

      return result.answers.find((item) => item.name === "action");
    }

    const response = await fetch(this.#config.DECISION_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        "authorization": `Bearer ${this.#config.DECISION_API_KEY}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(this.#config.AI_TIMEOUT_MS),
      body: JSON.stringify({
        model: this.#config.DECISION_MODEL,
        state: input,
        questions: { action: { type: "choice", instructions, criteria } },
      }),
    });

    if (!response.ok) {
      throw new Error(`决策服务请求失败（HTTP ${response.status}）`);
    }

    let body: unknown = await response.json();
    // Clef returns the decision data inside the Workers AI 'result' field.
    if (this.#config.DECISION_PROVIDER === "clef") {
      if (!Value.Check(clefResponse, body)) {
        throw new Error("Clef 未返回成功的决策结果");
      }

      body = body.result;
    }

    if (!Value.Check(decisionResponse, body)) {
      throw new Error("决策服务返回的 answers 格式不正确");
    }

    return body.answers.action;
  }

  public async choose(
    purpose: string,
    instructions: string,
    state: unknown,
    criteria: Record<string, string>,
  ): Promise<string | null> {
    if (this.#config.DECISION_PROVIDER === "llm") {
      return null;
    }

    const input = JSON.stringify(state);
    const label = [logContext.getStore()?.task, purpose]
      .filter(Boolean)
      .join(" ");

    if (input.length > this.#config.AI_INPUT_CHARS) {
      this.#logger.debug(
        "%s 决策输入过长（%s 字符），由 Agent 继续判断",
        label,
        input.length,
      );

      return null;
    }

    const startedAt = performance.now();

    this.#logger.info(
      "%s 独立决策开始：provider=%s model=%s chars=%s",
      label,
      this.#config.DECISION_PROVIDER,
      this.#config.DECISION_MODEL,
      input.length,
    );

    try {
      await reserveCall(
        this.#config,
        this.#store,
        {
          model: this.#config.DECISION_MODEL,
          baseURL: this.#config.DECISION_URL,
          apiKey: this.#config.DECISION_API_KEY,
        },
        `decision:${purpose}`,
      );
      const answer = await this.#evaluate(input, instructions, criteria);

      if (!Value.Check(choiceSchema, answer)) {
        throw new Error("决策服务返回的选项或置信度格式不正确");
      }

      if (!Object.hasOwn(criteria, answer.choice)) {
        throw new Error("决策服务返回了未提供的选项");
      }

      const accepted = answer.confidence >= this.#config.DECISION_CONFIDENCE;

      this.#logger.info(
        "%s 独立决策完成：choice=%s confidence=%s accepted=%s 耗时=%s ms",
        label,
        answer.choice,
        answer.confidence,
        accepted,
        Math.round(performance.now() - startedAt),
      );

      return accepted ? answer.choice : null;
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        throw error;
      }

      this.#logger.warn(
        "%s 独立决策失败，改由 Agent 判断：%s",
        label,
        logDetail(failureMessage(error), this.#config),
      );
      this.#logger.debug(
        "%s 决策异常：%s",
        label,
        logDetail(error, this.#config),
      );

      return null;
    }
  }
}
