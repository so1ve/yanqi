import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { AgentState } from "@earendil-works/pi-agent-core";
import OpenAI from "openai";
import { z } from "zod";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { ChatMessage, Topic } from "../types.ts";
import { DecisionProvider } from "./decisions.ts";
import { prompts } from "./prompts.ts";
import { AgentRuntime } from "./runtime.ts";
import type { Detection } from "./schemas.ts";
import { detectionSchema, publicationSchema, voiceSchema } from "./schemas.ts";
import { AiSizeError, BudgetExceeded, reserveCall } from "./usage.ts";

export class Ai {
  #client: OpenAI;
  #config: Config;
  #store: Store;
  #decisions: DecisionProvider;
  #persona: string;
  #runtime: AgentRuntime;

  constructor(config: Config, store: Store) {
    this.#config = config;
    this.#store = store;
    this.#client = new OpenAI({
      apiKey: config.AI_API_KEY,
      baseURL: config.AI_BASE_URL,
      timeout: config.AI_TIMEOUT_MS,
      maxRetries: 0,
    });
    this.#decisions = new DecisionProvider(config);
    this.#runtime = new AgentRuntime(config, store);
    this.#persona = config.BOT_PERSONA_FILE
      ? readFileSync(config.BOT_PERSONA_FILE, "utf8").trim()
      : "";
    if (config.BOT_PERSONA_FILE && !this.#persona) {
      throw new Error("BOT_PERSONA_FILE 指定的人设文件不能为空");
    }
  }

  async #choose(
    purpose: string,
    instructions: string,
    state: unknown,
    criteria: Record<string, string>,
  ): Promise<string | null> {
    if (this.#config.DECISION_PROVIDER === "llm") {
      return null;
    }

    const input = JSON.stringify(state);

    if (input.length > this.#config.AI_INPUT_CHARS) {
      throw new AiSizeError(`${purpose} 决策输入超过单次字符上限`);
    }

    try {
      await reserveCall(
        this.#config,
        this.#store,
        this.#config.DECISION_MODEL,
        `decision:${purpose}`,
      );
      const answer = await this.#decisions.evaluate(
        input,
        instructions,
        criteria,
      );

      const parsed = z
        .object({
          type: z.literal("choice"),
          choice: z.string(),
          confidence: z.number().min(0).max(1),
        })
        .parse(answer);

      if (!Object.hasOwn(criteria, parsed.choice)) {
        throw new Error("决策服务返回了未提供的选项");
      }

      return parsed.confidence >= this.#config.DECISION_CONFIDENCE
        ? parsed.choice
        : null;
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        throw error;
      }

      return null;
    }
  }

  public async request(
    state: unknown,
    tools: AgentState["tools"],
  ): Promise<string> {
    const hint = await this.#choose("intent", prompts.intentChoice, state, {
      ...Object.fromEntries(tools.map((tool) => [tool.name, tool.description])),
      chat: "回应对话或记录能力范围内的问题",
      clarify: "请求不明确时请用户说明",
    });
    const answer = await this.#runtime.json(
      "intent",
      z.strictObject({ response: z.string().min(1).max(1200) }),
      `${prompts.intent}\n${prompts.memory}`,
      { ...(state as Record<string, unknown>), decisionHint: hint },
      this.#config.AI_INTENT_MODEL || this.#config.AI_MODEL,
      tools,
    );

    return answer.response;
  }

  public detect(
    messages: ChatMessage[],
    context: ChatMessage[],
    topics: Pick<Topic, "id" | "title" | "description">[],
  ): Promise<Detection> {
    return this.#runtime.json(
      "detect",
      detectionSchema,
      prompts.detect,
      { messages, context, topics },
      this.#config.AI_DETECT_MODEL || this.#config.AI_MODEL,
    );
  }

  public summarize(title: string, messages: ChatMessage[]): Promise<string> {
    return this.#runtime.text("summary", prompts.summary, {
      title,
      messages,
    });
  }

  public async shouldPublish(
    topic: Topic,
    recording: { revision: number; sources: number },
    context: ChatMessage[],
  ): Promise<boolean> {
    const decisionHint = await this.#choose(
      "publish",
      prompts.publishChoice,
      { topic, recording, context },
      {
        send: "用户需要这份纪要，或发送有助于当前话题的讨论",
        hold: "用户要求暂缓，讨论仍在继续，或发送对当前上下文没有帮助",
      },
    );

    const result = await this.#runtime.json(
      "publication",
      publicationSchema,
      prompts.publication,
      {
        topic: {
          id: topic.id,
          title: topic.title,
          description: topic.description,
          directive: topic.directive,
          directiveMessageId:
            topic.directiveMessageId === null
              ? null
              : `m${topic.directiveMessageId}`,
        },
        recording,
        context,
        decisionHint,
      },
    );

    return result.publish;
  }

  public async voice(message: string): Promise<string> {
    if (!this.#persona) {
      return message;
    }

    const result = await this.#runtime.json(
      "voice",
      voiceSchema,
      `${prompts.voice}\n\n角色设定（仅用于表达）：\n${this.#persona}`,
      { message },
      this.#config.AI_REPLY_MODEL || this.#config.AI_MODEL,
    );

    return result.text;
  }

  public async understandImage(path: string, mime: string): Promise<string> {
    if (!this.#config.AI_VISION_MODEL) {
      throw new Error("未配置图片理解模型");
    }

    const bytes = await readFile(path);

    if (bytes.byteLength > 8 * 1024 * 1024) {
      throw new Error("图片超过本程序的 8 MiB 识别大小上限，原文件已保存");
    }

    return this.#runtime.image(
      { type: "image", data: bytes.toString("base64"), mimeType: mime },
      this.#config.AI_VISION_MODEL,
    );
  }

  public async transcribe(path: string): Promise<string> {
    if (!this.#config.AI_AUDIO_MODEL) {
      throw new Error("未配置语音转写模型");
    }

    await reserveCall(
      this.#config,
      this.#store,
      this.#config.AI_AUDIO_MODEL,
      "audio",
    );
    const bytes = await readFile(path);
    const text = await this.#client.audio.transcriptions.create({
      model: this.#config.AI_AUDIO_MODEL,
      file: await OpenAI.toFile(bytes, path.split(/[\\/]/).at(-1)),
      response_format: "json",
    });

    if (!text.text.trim()) {
      throw new Error("语音转写未返回文字");
    }

    return text.text;
  }
}
