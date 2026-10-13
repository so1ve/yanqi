import type { AgentState, FinishTurn } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model, UserMessage } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { Logger } from "@koishijs/core";
import { jsonrepair } from "jsonrepair";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import type { Static, TSchema } from "typebox";
import * as Value from "typebox/value";

import type { Config, ModelConfig } from "../config.ts";
import type { Store } from "../storage/store.ts";
import { AiError } from "../utils/errors.ts";
import { logContext, logDetail } from "../utils/logging.ts";
import { logAgentEvents } from "./logging.ts";
import { boundary } from "./prompts/common.ts";
import { AiSizeError, reserveCall } from "./usage.ts";

interface RequestOptions {
  model?: ModelConfig;
  tools?: AgentState["tools"];
  thinking?: boolean;
  finishTurn?: FinishTurn;
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

    const text = await this.#run(
      purpose,
      `${boundary}\n${instructions}`,
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

  public text(
    purpose: string,
    instructions: string,
    input: unknown,
    options: RequestOptions = {},
  ): Promise<string> {
    return this.#run(
      purpose,
      `${boundary}\n${instructions}`,
      { role: "user", content: JSON.stringify(input), timestamp: Date.now() },
      options,
    );
  }

  public image(
    image: ImageContent,
    model: ModelConfig,
    instructions: string,
  ): Promise<string> {
    return this.#run(
      "image",
      `${boundary}\n${instructions}`,
      { role: "user", content: [image], timestamp: Date.now() },
      { model },
    );
  }

  async #run(
    purpose: string,
    instructions: string,
    input: UserMessage,
    options: RequestOptions,
    schema?: TSchema,
  ): Promise<string> {
    const signal = options.signal
      ? AbortSignal.any([this.#signal, options.signal])
      : this.#signal;

    signal.throwIfAborted();
    const config = this.#config;
    const endpoint = options.model ?? config.AI_MODEL;
    const tools = options.tools ?? [];
    const modelId = endpoint.model;
    const isDeepSeek =
      new URL(endpoint.baseURL).hostname === "api.deepseek.com";
    const thinkingLevel = options.thinking && isDeepSeek ? "high" : "off";
    const maxTokens =
      thinkingLevel === "off"
        ? config.AI_MAX_OUTPUT_TOKENS
        : config.AI_THINKING_MAX_OUTPUT_TOKENS;
    const timeoutMs =
      thinkingLevel === "off"
        ? config.AI_TIMEOUT_MS
        : config.AI_THINKING_TIMEOUT_MS;
    const task = logContext.getStore();
    const label = [
      task?.task,
      task && `group=${task.groupId}`,
      task?.requestId && `request=m${task.requestId}`,
      `AI #${++this.#calls}`,
      purpose,
    ]
      .filter(Boolean)
      .join(" ");
    const startedAt = performance.now();
    const model: Model<"openai-completions"> = {
      id: modelId,
      name: modelId,
      api: "openai-completions",
      provider: "yanqi",
      baseUrl: endpoint.baseURL,
      input: ["text", "image"],
      // reasoning 声明模型能力；thinkingLevel 控制是否启用思考。
      reasoning: isDeepSeek,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      // 输入字符预算不是模型上下文容量。0 让 SDK 保留配置的输出额度。
      contextWindow: 0,
      maxTokens,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: isDeepSeek,
        supportsStrictMode: false,
        maxTokensField: "max_tokens",
      },
    };
    let turns = 0;
    const calls: number[] = [];
    let failure: Error | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const agent = new Agent({
      initialState: {
        model,
        thinkingLevel,
        systemPrompt: schema
          ? `${instructions}\n最终回复必须是符合以下 JSON Schema 的 JSON 对象：\n${JSON.stringify(schema)}`
          : instructions,
        tools,
      },
      toolExecution: "sequential",
      ...(options.finishTurn ? { finishTurn: options.finishTurn } : {}),
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

          return streamSimple(model, context, {
            ...streamOptions,
            apiKey: endpoint.apiKey,
            maxTokens,
            maxRetries: 0,
            timeoutMs,
          });
        } catch (error) {
          if (error instanceof Error) {
            failure = error;
          }

          throw error;
        }
      },
      onPayload: (payload) => {
        const params = payload as ChatCompletionCreateParamsStreaming;

        // 主对话通过工具交付结果，包括明确决定不回复。
        if (tools.length > 0) {
          params.tool_choice = "required";
        }

        if (schema) {
          params.response_format =
            config.AI_RESPONSE_FORMAT === "json_schema"
              ? {
                  type: "json_schema",
                  json_schema: {
                    name: purpose,
                    strict: true,
                    schema: { ...schema },
                  },
                }
              : { type: "json_object" };
        }

        // 在 SDK 完成参数转换后记录，确保日志与实际请求一致。
        this.#logger.info(
          "%s 第 %s 轮请求：usage=%s provider=%s model=%s thinking=%s messages=%s chars=%s tools=%s tool_choice=%s max_tokens=%s timeout=%s ms",
          label,
          turns,
          calls.at(-1),
          new URL(endpoint.baseURL).origin,
          params.model,
          isDeepSeek ? thinkingLevel : "provider-default",
          params.messages.length,
          JSON.stringify(params.messages).length,
          params.tools?.length ?? 0,
          params.tool_choice ?? "default",
          params.max_tokens,
          timeoutMs,
        );

        return params;
      },
    });

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
      const messages = agent.state.messages.filter(
        (message) => message.role === "assistant",
      );

      await this.#store.usage
        .record(
          calls.map((id, index) => {
            const message = messages[index];
            const usage = message?.usage.totalTokens ? message.usage : null;

            return {
              id,
              input: usage?.input ?? null,
              output: usage?.output ?? null,
              cacheRead: usage?.cacheRead ?? null,
              cacheWrite: usage?.cacheWrite ?? null,
              durationMs:
                message?.durationMs === undefined
                  ? null
                  : Math.round(message.durationMs),
            };
          }),
        )
        .catch((error) =>
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
        `${purpose} 输出达到长度限制（model=${modelId}，finishReason=${result.rawStopReason ?? result.stopReason}，outputTokens=${result.usage.output}，maxTokens=${maxTokens}，responseId=${result.responseId ?? "未提供"}）`,
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

    return text;
  }
}
