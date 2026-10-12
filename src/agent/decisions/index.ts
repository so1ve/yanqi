import { Logger } from "koishi";
import { Type } from "typebox";
import * as Value from "typebox/value";

import type { Config } from "../../config.ts";
import type { Store } from "../../storage/store.ts";
import { failureMessage } from "../../utils/errors.ts";
import { logContext, logDetail } from "../../utils/logging.ts";
import { prompts } from "../prompts/recording.ts";
import type { AgentRuntime } from "../runtime.ts";
import { BudgetExceeded, reserveCall } from "../usage.ts";
import { createClefDecision } from "./clef.ts";
import { createJevDecision } from "./jev.ts";
import { choosePublication } from "./llm.ts";
import { createOpenAIDecision } from "./openai.ts";
import type { EvaluateDecision } from "./types.ts";

const choiceSchema = Type.Object({
  type: Type.Literal("choice"),
  choice: Type.String(),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});

function createIndependentDecision(config: Config): EvaluateDecision | null {
  switch (config.DECISION_PROVIDER) {
    case "llm":
      return null;
    case "openai":
    case "vercel":
      return createOpenAIDecision(config);
    case "jev":
      return createJevDecision(config);
    case "clef":
      return createClefDecision(config);
  }
}

export class Decisions {
  #config: Config;
  #store: Store;
  #runtime: AgentRuntime;
  #logger = new Logger("yanqi:ai");
  #evaluate: EvaluateDecision | null;

  constructor(config: Config, store: Store, runtime: AgentRuntime) {
    this.#config = config;
    this.#store = store;
    this.#runtime = runtime;
    this.#evaluate = createIndependentDecision(config);
  }

  public async choosePublication(input: Record<string, unknown>) {
    const decisionHint = await this.#hint(
      "publish",
      prompts.publishChoice,
      input,
      {
        send: "用户需要这份纪要，或发送有助于当前话题的讨论",
        notify: "用户正在等保存结果，或简短告知新记录有助于当前讨论；不发全文",
        silent: "补整理旧聊天、后台更新或当前已无须通知，只保存在本地",
      },
    );

    return choosePublication(this.#runtime, input, decisionHint);
  }

  async #hint(
    purpose: string,
    instructions: string,
    state: unknown,
    criteria: Record<string, string>,
  ): Promise<string | null> {
    if (!this.#evaluate) {
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
      const answer = await this.#evaluate({ input, instructions, criteria });

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
