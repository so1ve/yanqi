import { Logger } from "@koishijs/core";
import { Type } from "typebox";
import * as Value from "typebox/value";

import type { Config } from "../../config.ts";
import type { Store } from "../../storage/store.ts";
import type { ChatMessage } from "../../types.ts";
import { logContext, logDetail } from "../../utils/logging.ts";
import { chatSourceRules } from "../prompts/common.ts";
import { decisionCriteria, decisionPrompt } from "../prompts/requests.ts";
import type { AgentRuntime } from "../runtime.ts";
import { reserveCall } from "../usage.ts";
import { createClefDecision } from "./clef.ts";
import { createJevDecision } from "./jev.ts";
import { selectMessages } from "./llm.ts";
import { createOpenAIDecision } from "./openai.ts";
import type { EvaluateDecision, MessageSelection } from "./types.ts";

const choiceSchema = Type.Object({
  choice: Type.Enum(["process", "memory", "ignore"]),
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

  public async selectMessages(
    groupId: string,
    messages: ChatMessage[],
    context: ChatMessage[],
    memoryOnly = false,
  ): Promise<MessageSelection> {
    const selected: MessageSelection = { requestIds: [], memoryIds: [] };

    // 按发言人分批，个人偏好不会影响同批的其他人。
    for (const userId of new Set(messages.map((message) => message.userId))) {
      const input = {
        messages: messages.map(decisionMessage),
        context: context.map(decisionMessage),
        requestUserId: userId,
        memory: await this.#store.memories.index(groupId, userId),
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
        const batch = await this.#classify(
          input,
          ids.slice(offset, offset + 64),
          memoryOnly,
        );

        selected.requestIds.push(...batch.requestIds);
        selected.memoryIds.push(...batch.memoryIds);
      }
    }

    return selected;
  }

  async #classify(
    state: Record<string, unknown>,
    candidates: string[],
    memoryOnly: boolean,
  ): Promise<MessageSelection> {
    const rules = `${decisionPrompt}\n${chatSourceRules(this.#config.BOT_QQ)}${memoryOnly ? "\n<attachment_review>附件解析完成，本轮只判断是否值得更新记忆。仅选择 memory 或 ignore，不重新回复、执行请求或叫醒主对话。</attachment_review>" : ""}`;
    const criteria = memoryOnly
      ? { memory: decisionCriteria.memory, ignore: decisionCriteria.ignore }
      : decisionCriteria;

    if (!this.#evaluate) {
      return selectMessages(
        this.#runtime,
        rules,
        state,
        candidates,
        memoryOnly,
      );
    }

    const questions = Object.fromEntries(
      candidates.map((id) => [
        id,
        {
          // 分类规则必须放在服务实际读取的 instructions 中，修改遵循 prompts/README.md。
          instructions: `${rules}\n<target>只分类 messages 中 ID 为 ${id} 的消息，从给定选项中选择对应的处理方式。</target>`,
          criteria,
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

        const first = await this.#classify(
          state,
          candidates.slice(0, middle),
          memoryOnly,
        );
        const rest = await this.#classify(
          state,
          candidates.slice(middle),
          memoryOnly,
        );

        return {
          requestIds: [...first.requestIds, ...rest.requestIds],
          memoryIds: [...first.memoryIds, ...rest.memoryIds],
        };
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
    const selected: MessageSelection = { requestIds: [], memoryIds: [] };

    this.#logger.debug(
      "%s 决策返回：%s",
      label,
      logDetail(answers, this.#config),
    );

    for (const id of candidates) {
      const answer = answers[id];

      if (!Value.Check(choiceSchema, answer) || !(answer.choice in criteria)) {
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
        selected.requestIds.push(id);
      } else if (answer.choice === "memory") {
        selected.memoryIds.push(id);
      }
    }

    this.#logger.info(
      "%s 独立决策完成：请求=%s 记忆=%s 候选=%s 耗时=%s ms",
      label,
      selected.requestIds.length,
      selected.memoryIds.length,
      candidates.length,
      Math.round(performance.now() - startedAt),
    );

    return selected;
  }
}
