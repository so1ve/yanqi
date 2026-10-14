import type {
  AgentMessage,
  AgentOptions,
  AgentState,
  FinishTurn,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent, UserMessage } from "@earendil-works/pi-ai";
import { Logger } from "@koishijs/core";
import { jsonrepair } from "jsonrepair";
import type { Static, TSchema } from "typebox";
import * as Value from "typebox/value";

import type { Config, ModelConfig } from "../config.ts";
import type { Conversation } from "../storage/conversations.ts";
import type { Store } from "../storage/store.ts";
import { AiError } from "../utils/errors.ts";
import { logContext, logDetail } from "../utils/logging.ts";
import { createCompletion } from "./completions.ts";
import { logAgentEvents } from "./logging.ts";
import { AiSizeError, recordCalls, reserveCall } from "./usage.ts";

interface RequestOptions {
  model?: ModelConfig;
  tools?: AgentState["tools"];
  thinking?: ThinkingLevel;
  finishTurn?: FinishTurn;
  beforeToolCall?: AgentOptions["beforeToolCall"];
  prepareNextTurn?: AgentOptions["prepareNextTurnWithContext"];
  signal?: AbortSignal;
  maxTurns?: number;
}

export class AgentRuntime {
  #config: Config;
  #store: Store;
  #logger = new Logger("yanqi:ai");
  #calls = 0;
  #signal: AbortSignal;

  constructor(config: Config, store: Store, signal: AbortSignal) {
    this.#config = config;
    this.#store = store;
    this.#signal = signal;
  }

  public async json<S extends TSchema>(
    purpose: string,
    schema: S,
    instructions: string,
    input: unknown,
    options: RequestOptions = {},
  ): Promise<Static<S>> {
    const content = JSON.stringify(input);
    const model = options.model ?? this.#config.AI_MODEL;

    const { text } = await this.#run(
      purpose,
      instructions,
      { role: "user", content, timestamp: Date.now() },
      options,
      schema,
    );
    let json: unknown;

    try {
      json = JSON.parse(text);
    } catch {
      try {
        json = JSON.parse(jsonrepair(text));
      } catch (error) {
        throw new AiError(
          "解析 AI 返回的 JSON",
          `${purpose} 返回的 JSON 无法修复（model=${model.model}，${text.length} 字符）`,
          { cause: error },
        );
      }

      this.#logger.info(
        "%s %s JSON 语法已修复（model=%s）",
        logContext.getStore()?.task ?? "AI",
        purpose,
        model.model,
      );
    }

    const parsed = Value.Clean(schema, json);

    if (!Value.Check(schema, parsed)) {
      throw new AiError(
        "校验 AI 返回的字段",
        `${purpose} JSON 字段不符合约定：${Value.Errors(schema, parsed)
          .map((error) => `${error.instancePath}: ${error.message}`)
          .join("；")}`,
      );
    }

    return parsed;
  }

  public async text(
    purpose: string,
    instructions: string,
    input: unknown,
    options: RequestOptions = {},
  ): Promise<string> {
    const result = await this.#run(
      purpose,
      instructions,
      { role: "user", content: JSON.stringify(input), timestamp: Date.now() },
      options,
    );

    return result.text;
  }

  public async image(
    image: ImageContent,
    model: ModelConfig,
    instructions: string,
  ): Promise<string> {
    const result = await this.#run(
      "image",
      instructions,
      { role: "user", content: [image], timestamp: Date.now() },
      { model },
    );

    return result.text;
  }

  public async converse(
    instructions: string,
    input: unknown,
    conversation: Conversation,
    options: RequestOptions,
  ): Promise<AgentMessage[]> {
    const result = await this.#run(
      "intent",
      instructions,
      { role: "user", content: JSON.stringify(input), timestamp: Date.now() },
      options,
      undefined,
      conversation,
    );

    return result.messages;
  }

  async #run(
    purpose: string,
    instructions: string,
    input: UserMessage,
    options: RequestOptions,
    schema?: TSchema,
    conversation?: Pick<Conversation, "id" | "messages">,
  ): Promise<{ text: string; messages: AgentMessage[] }> {
    const signal = options.signal
      ? AbortSignal.any([this.#signal, options.signal])
      : this.#signal;

    signal.throwIfAborted();
    const config = this.#config;
    const endpoint = options.model ?? config.AI_MODEL;
    const tools = options.tools ?? [];
    const completion = createCompletion(
      config,
      endpoint,
      purpose,
      options.thinking,
      schema,
    );
    const { model, thinkingLevel, timeoutMs } = completion;
    const task = logContext.getStore();
    const label = [
      task?.task,
      task && `group=${task.groupId}`,
      task?.requestId && `request=m${task.requestId}`,
      conversation && `session=${conversation.id}`,
      `AI #${++this.#calls}`,
      purpose,
    ]
      .filter(Boolean)
      .join(" ");
    const startedAt = performance.now();
    let turns = 0;
    const calls: number[] = [];
    let failure: Error | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const agent = new Agent({
      ...(conversation ? { sessionId: conversation.id } : {}),
      initialState: {
        model,
        thinkingLevel,
        // 输出协议也是提示词的一部分，修改遵循 prompts/README.md；字段仍由 Schema 校验。
        systemPrompt: schema
          ? `${instructions}\n<json_output>最终只返回符合此 JSON Schema 的 JSON 对象，不附加说明或代码围栏：\n${JSON.stringify(schema)}\n</json_output>`
          : instructions,
        tools,
        messages: conversation?.messages ?? [],
      },
      toolExecution: "sequential",
      ...(options.beforeToolCall
        ? { beforeToolCall: options.beforeToolCall }
        : {}),
      ...(options.finishTurn ? { finishTurn: options.finishTurn } : {}),
      ...(options.prepareNextTurn
        ? { prepareNextTurnWithContext: options.prepareNextTurn }
        : {}),
      streamFn: async (_model, context, streamOptions) => {
        try {
          if (++turns > (options.maxTurns ?? 8)) {
            throw new AiError(
              "处理对话",
              `${purpose} 已达到单次请求的 ${options.maxTurns ?? 8} 轮模型调用上限`,
            );
          }

          calls.push(await reserveCall(config, this.#store, endpoint, purpose));
          timeout = setTimeout(() => agent.abort(), timeoutMs);
          timeout.unref();

          return completion.stream(
            context,
            streamOptions,
            `${label} 第 ${turns} 轮请求：usage=${calls.at(-1)}`,
          );
        } catch (error) {
          if (error instanceof Error) {
            failure = error;
          }

          throw error;
        }
      },
    });
    const previousMessages = agent.state.messages.length;

    logAgentEvents(agent, config, label);
    // 只限制每轮模型请求；工具等待结果期间不计入模型超时。
    agent.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        clearTimeout(timeout);
      }
    });
    this.#logger.debug(
      "%s 输入：\n%s",
      label,
      logDetail(
        typeof input.content === "string"
          ? JSON.parse(input.content)
          : input.content.map((part) =>
              part.type === "image" ? `[图片 ${part.mimeType}]` : part.text,
            ),
        config,
      ),
    );

    const abort = () => agent.abort();

    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      await agent.prompt(input);
      signal.throwIfAborted();
    } finally {
      signal.removeEventListener("abort", abort);
      clearTimeout(timeout);
      await recordCalls(
        this.#store,
        calls,
        agent.state.messages.slice(previousMessages),
      ).catch((error) =>
        this.#logger.warn(
          "%s 用量保存失败：%s",
          label,
          logDetail(error, config),
        ),
      );
      this.#logger.info(
        "%s 会话结束：rounds=%s 耗时=%s ms",
        label,
        turns,
        Math.round(performance.now() - startedAt),
      );
    }

    if (failure) {
      throw failure;
    }

    const result = agent.state.messages.findLast(
      (item) => item.role === "assistant",
    );

    if (result?.stopReason === "length") {
      throw new AiSizeError(
        `${purpose} 输出达到长度限制（model=${model.id}，finishReason=${result.rawStopReason ?? result.stopReason}，outputTokens=${result.usage.output}，maxTokens=${model.maxTokens}，responseId=${result.responseId ?? "未提供"}）`,
      );
    }

    // 工具会话通过 finishTurn 结束，末次结果可以是工具调用。
    if (result?.stopReason !== "stop" && result?.stopReason !== "toolUse") {
      throw new AiError(
        "获取 AI 回复",
        `${purpose} 未返回完整结果（${result?.errorMessage || result?.stopReason || "无内容"}）`,
      );
    }

    const text = result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");

    // 工具调用的结果已经交付，不要求额外的文字答复。
    if (!text.trim() && tools.length === 0) {
      throw new AiError("读取 AI 正文", `${purpose} 未返回文字`);
    }

    return {
      text,
      // 系统提示词和工具定义使用本次配置，不能跟随旧会话重放。
      messages: agent.state.messages.filter(
        (message) => message.role !== "system",
      ),
    };
  }
}
