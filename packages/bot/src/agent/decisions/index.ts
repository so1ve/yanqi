import { Logger } from "@koishijs/core";
import { Type } from "typebox";
import * as Value from "typebox/value";

import type { Config } from "../../config.ts";
import type { Store } from "../../storage/store.ts";
import type { ChatMessage } from "../../types.ts";
import { logContext, logDetail } from "../../utils/logging.ts";
import { chatSourceRules } from "../prompts/common.ts";
import { prompts as conversationPrompts } from "../prompts/conversation.ts";
import type { AgentRuntime } from "../runtime.ts";
import { reserveCall } from "../usage.ts";
import { createClefDecision } from "./clef.ts";
import { createJevDecision } from "./jev.ts";
import { selectRequests } from "./llm.ts";
import { createOpenAIDecision } from "./openai.ts";
import type { EvaluateDecision } from "./types.ts";

const choiceSchema = Type.Object({
  choice: Type.Enum(["process", "ignore"]),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});

function decisionMessage(message: ChatMessage) {
  // 决策只读聊天内容，后台附件任务留给主 Agent 处理。
  const { attachmentTasks, ...content } = message;

  return content;
}

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

  public async selectRequests(
    groupId: string,
    messages: ChatMessage[],
    context: ChatMessage[],
  ): Promise<string[]> {
    const selected: string[] = [];

    // 按发言人分批，个人偏好不会影响同批的其他人。
    for (const userId of new Set(messages.map((message) => message.userId))) {
      const input = {
        messages: messages.map(decisionMessage),
        context: context.map(decisionMessage),
        requestUserId: userId,
        memory: await this.#store.memories.context(groupId, userId),
      };
      const ids = [
        ...new Set(
          messages
            .filter((message) => message.userId === userId)
            .map((message) => message.id),
        ),
      ];

      // Clef 每次最多接受 64 个问题。
      for (let offset = 0; offset < ids.length; offset += 64) {
        selected.push(
          ...(await this.#classify(input, ids.slice(offset, offset + 64))),
        );
      }
    }

    return selected;
  }

  async #classify(
    state: Record<string, unknown>,
    candidates: string[],
  ): Promise<string[]> {
    const rules = `${chatSourceRules(this.#config.BOT_QQ)}\n${conversationPrompts.requests}`;

    if (!this.#evaluate) {
      return selectRequests(this.#runtime, rules, state, candidates);
    }

    const questions = Object.fromEntries(
      candidates.map((id) => [
        id,
        {
          instructions: `${rules}\n只判断 messages 中 ID 为 ${id} 的消息，其他消息仅供理解上下文。memory.user 属于 requestUserId。`,
          criteria: {
            process:
              "当前有让小栖执行、回答或更新偏好的意图，包括未 @ 的明确整理要求、对刚才请求的补充或催办。少闲聊不妨碍处理具体任务。",
            ignore:
              "当前没有向小栖提出任务、问题或偏好变更：群友闲聊、分享表情、讨论功能、转述指令，或按群约定无需回应的普通招呼。",
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
      if (candidates.length > 1) {
        const middle = Math.ceil(candidates.length / 2);

        return [
          ...(await this.#classify(state, candidates.slice(0, middle))),
          ...(await this.#classify(state, candidates.slice(middle))),
        ];
      }

      throw new Error(
        `请求识别的输入过长：${size} 字符，超过 AI_INPUT_CHARS=${this.#config.AI_INPUT_CHARS}`,
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
