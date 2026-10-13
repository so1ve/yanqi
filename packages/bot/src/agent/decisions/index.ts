import { Logger } from "@koishijs/core";
import { Type } from "typebox";
import * as Value from "typebox/value";

import type { Config } from "../../config.ts";
import type { Store } from "../../storage/store.ts";
import type { ChatMessage } from "../../types.ts";
import { logContext, logDetail } from "../../utils/logging.ts";
import { prompts as conversationPrompts } from "../prompts/conversation.ts";
import type { AgentRuntime } from "../runtime.ts";
import { reserveCall } from "../usage.ts";
import { createClefDecision } from "./clef.ts";
import { createJevDecision } from "./jev.ts";
import { recordingRequests } from "./llm.ts";
import { createOpenAIDecision } from "./openai.ts";
import type { EvaluateDecision } from "./types.ts";

const choiceSchema = Type.Object({
  choice: Type.Enum(["process", "ignore"]),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});

function createIndependentDecision(config: Config): EvaluateDecision | null {
  switch (config.DECISION_PROVIDER) {
    case "llm": {
      return null;
    }

    case "openai":
    case "vercel": {
      return createOpenAIDecision(config);
    }

    case "jev": {
      return createJevDecision(config);
    }

    case "clef": {
      return createClefDecision(config);
    }
  }
}

export class Decisions {
  #config: Config;
  #store: Store;
  #runtime: AgentRuntime;
  #logger = new Logger("yanqi:ai");
  #evaluate: EvaluateDecision | null;
  #signal: AbortSignal;

  constructor(
    config: Config,
    store: Store,
    runtime: AgentRuntime,
    signal: AbortSignal,
  ) {
    this.#config = config;
    this.#store = store;
    this.#runtime = runtime;
    this.#evaluate = createIndependentDecision(config);
    this.#signal = signal;
  }

  public async recordingRequests(
    messages: ChatMessage[],
    context: ChatMessage[],
  ): Promise<string[]> {
    const input = { messages, context };
    const ids = [...new Set(messages.map((message) => message.id))];
    const selected: string[] = [];

    // Clef 每次最多接受 64 个问题，同一批消息共用上下文。
    for (let offset = 0; offset < ids.length; offset += 64) {
      const candidates = ids.slice(offset, offset + 64);

      selected.push(...(await this.#classify(input, candidates)));
    }

    return selected;
  }

  async #classify(
    state: Record<string, unknown>,
    candidates: string[],
  ): Promise<string[]> {
    if (!this.#evaluate) {
      return recordingRequests(this.#runtime, state, candidates);
    }

    const questions = Object.fromEntries(
      candidates.map((id) => [
        id,
        {
          instructions: `${conversationPrompts.recordingRequests}\n本题只判断 messages 中 ID 为 ${id} 的消息。`,
          criteria: {
            process: "当前发言确实在要求小栖执行一项记录事务",
            ignore:
              "没有要求小栖执行；包括讨论记录功能、介绍权限、转述指令和闲聊",
          },
        },
      ]),
    );
    const input = JSON.stringify(state);
    const size = input.length + JSON.stringify(questions).length;
    const label = [logContext.getStore()?.task, "observe"]
      .filter(Boolean)
      .join(" ");

    if (size > this.#config.AI_INPUT_CHARS) {
      throw new Error(
        `记录请求识别的输入过长：${size} 字符，超过 AI_INPUT_CHARS=${this.#config.AI_INPUT_CHARS}`,
      );
    }

    const startedAt = performance.now();

    this.#logger.info(
      "%s 独立决策开始：provider=%s model=%s questions=%s chars=%s",
      label,
      this.#config.DECISION_PROVIDER,
      this.#config.DECISION_MODEL,
      candidates.length,
      size,
    );
    this.#logger.debug(
      "%s 决策输入：%s",
      label,
      logDetail({ state, questions }, this.#config),
    );

    await reserveCall(
      this.#config,
      this.#store,
      {
        model: this.#config.DECISION_MODEL,
        baseURL: this.#config.DECISION_URL,
        apiKey: this.#config.DECISION_API_KEY,
      },
      "decision:observe",
    );
    const answers = await this.#evaluate({ input, questions }, this.#signal);
    const selected: string[] = [];

    this.#logger.debug(
      "%s 决策返回：%s",
      label,
      logDetail(answers, this.#config),
    );

    for (const id of candidates) {
      const answer = answers[id];

      if (!Value.Check(choiceSchema, answer)) {
        throw new Error(`决策服务返回的消息 ${id} 的选项或置信度格式不正确`);
      }

      const forward = answer.choice === "process";

      this.#logger.info(
        "%s %s：choice=%s confidence=%s 转交主 Agent=%s",
        label,
        id,
        answer.choice,
        answer.confidence,
        forward,
      );

      if (forward) {
        selected.push(id);
      }
    }

    this.#logger.info(
      "%s 独立决策完成：接收请求=%s/%s 耗时=%s ms",
      label,
      selected.length,
      candidates.length,
      Math.round(performance.now() - startedAt),
    );

    return selected;
  }
}
