import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { Logger } from "@koishijs/core";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import type { TSchema } from "typebox";

import type { Config, ModelConfig } from "../config.ts";

const logger = new Logger("yanqi:ai");

export function createCompletion(
  config: Config,
  endpoint: ModelConfig,
  purpose: string,
  thinking: ThinkingLevel = "off",
  schema?: TSchema,
) {
  const isDeepSeek = new URL(endpoint.baseURL).hostname === "api.deepseek.com";
  const thinkingLevel = isDeepSeek ? thinking : "off";
  const maxTokens =
    thinkingLevel === "off"
      ? config.AI_MAX_OUTPUT_TOKENS
      : config.AI_THINKING_MAX_OUTPUT_TOKENS;
  const timeoutMs =
    thinkingLevel === "off"
      ? config.AI_TIMEOUT_MS
      : config.AI_THINKING_TIMEOUT_MS;
  const model: Model<"openai-completions"> = {
    id: endpoint.model,
    name: endpoint.model,
    api: "openai-completions",
    provider: "yanqi",
    baseUrl: endpoint.baseURL,
    input: ["text", "image"],
    // reasoning 声明模型能力；thinkingLevel 控制本次是否启用思考。
    reasoning: isDeepSeek,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // 视觉模型使用独立服务，不套用主模型的容量。
    contextWindow: endpoint === config.AI_MODEL ? config.AI_CONTEXT_TOKENS : 0,
    maxTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: isDeepSeek,
      supportsStrictMode: false,
      maxTokensField: "max_tokens",
    },
  };

  return {
    model,
    thinkingLevel,
    timeoutMs,
    stream(
      context: TranscriptContext,
      options: SimpleStreamOptions | undefined,
      label: string,
    ) {
      return streamSimple(model, context, {
        ...options,
        apiKey: endpoint.apiKey,
        maxTokens,
        maxRetries: 0,
        timeoutMs,
        onPayload(payload) {
          const params = payload as ChatCompletionCreateParamsStreaming;

          if (params.tools?.length) {
            // DeepSeek 思考模式不接受 required；是否完成由 Agent 的工具结果决定。
            params.tool_choice =
              isDeepSeek && thinkingLevel !== "off" ? "auto" : "required";
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

          // 记录 SDK 转换后的实际请求，不记录密钥。
          logger.info(
            "%s provider=%s model=%s thinking=%s context_window=%s messages=%s chars=%s tools=%s tool_choice=%s max_tokens=%s timeout=%s ms",
            label,
            new URL(endpoint.baseURL).origin,
            params.model,
            isDeepSeek ? thinkingLevel : "provider-default",
            model.contextWindow || "provider-default",
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
    },
  };
}
