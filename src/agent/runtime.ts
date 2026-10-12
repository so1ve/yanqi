import type { AgentState } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model, UserMessage } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { z } from "zod";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import { boundary, prompts } from "./prompts.ts";
import { AiSizeError, reserveCall } from "./usage.ts";

export class AgentRuntime {
  #config: Config;
  #store: Store;

  constructor(config: Config, store: Store) {
    this.#config = config;
    this.#store = store;
  }

  public async json<S extends z.ZodType>(
    purpose: string,
    schema: S,
    instructions: string,
    input: unknown,
    model = this.#config.AI_MODEL,
    tools: AgentState["tools"] = [],
  ): Promise<z.output<S>> {
    const content = JSON.stringify(input);

    const text = await this.#run(
      purpose,
      `${boundary}\n${instructions}`,
      { role: "user", content, timestamp: Date.now() },
      model,
      tools,
      schema,
    );
    let json: unknown;

    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${purpose} 未返回合法 JSON`);
    }

    const parsed = schema.safeParse(json);

    if (!parsed.success) {
      throw new Error(
        `${purpose} JSON 字段不符合约定：${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；")}`,
      );
    }

    return parsed.data;
  }

  public text(
    purpose: string,
    instructions: string,
    input: unknown,
  ): Promise<string> {
    return this.#run(
      purpose,
      `${boundary}\n${instructions}`,
      { role: "user", content: JSON.stringify(input), timestamp: Date.now() },
      this.#config.AI_MODEL,
      [],
    );
  }

  public image(image: ImageContent, model: string): Promise<string> {
    return this.#run(
      "image",
      prompts.image,
      { role: "user", content: [image], timestamp: Date.now() },
      model,
      [],
    );
  }

  async #run(
    purpose: string,
    instructions: string,
    input: UserMessage,
    modelId: string,
    tools: AgentState["tools"],
    schema?: z.ZodType,
  ): Promise<string> {
    const config = this.#config;
    const responseSchema = schema ? z.toJSONSchema(schema) : undefined;
    const model: Model<"openai-completions"> = {
      id: modelId,
      name: modelId,
      api: "openai-completions",
      provider: "yanqi",
      baseUrl: config.AI_BASE_URL,
      input: ["text", "image"],
      reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: config.AI_INPUT_CHARS + config.AI_MAX_OUTPUT_TOKENS,
      maxTokens: config.AI_MAX_OUTPUT_TOKENS,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsStrictMode: false,
        maxTokensField: "max_tokens",
      },
    };
    let turns = 0;
    let failure: Error | undefined;
    const agent = new Agent({
      initialState: {
        model,
        systemPrompt: responseSchema
          ? `${instructions}\n最终回复必须是符合以下 JSON Schema 的 JSON 对象：\n${JSON.stringify(responseSchema)}`
          : instructions,
        tools,
      },
      toolExecution: "sequential",
      streamFn: async (_model, context, options) => {
        try {
          if (++turns > 8) {
            throw new Error(`${purpose} agent 已达到单次请求的 8 轮调用上限`);
          }

          await reserveCall(config, this.#store, modelId, purpose);

          return streamSimple(model, context, {
            ...options,
            apiKey: config.AI_API_KEY,
            maxTokens: config.AI_MAX_OUTPUT_TOKENS,
            maxRetries: 0,
            timeoutMs: config.AI_TIMEOUT_MS,
          });
        } catch (error) {
          if (error instanceof Error) {
            failure = error;
          }

          throw error;
        }
      },
      onPayload: responseSchema
        ? (payload) => ({
            ...(payload as Record<string, unknown>),
            response_format:
              config.AI_RESPONSE_FORMAT === "json_schema"
                ? {
                    type: "json_schema",
                    json_schema: {
                      name: purpose,
                      strict: true,
                      schema: responseSchema,
                    },
                  }
                : { type: "json_object" },
          })
        : undefined,
    });

    const timeout = setTimeout(() => agent.abort(), config.AI_TIMEOUT_MS);

    timeout.unref();
    try {
      await agent.prompt(input);
    } finally {
      clearTimeout(timeout);
    }

    if (failure) {
      throw failure;
    }

    const result = agent.state.messages.findLast(
      (item) => item.role === "assistant",
    );

    if (result?.stopReason === "length") {
      throw new AiSizeError(`${purpose} 输出被截断`);
    }

    if (result?.stopReason !== "stop") {
      throw new Error(
        `${purpose} 未返回完整结果（${result?.errorMessage || result?.stopReason || "无内容"}）`,
      );
    }

    const text = result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");

    if (!text.trim()) {
      throw new Error(`${purpose} 未返回文字`);
    }

    return text;
  }
}
