import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { AgentState } from "@earendil-works/pi-agent-core";
import { Logger } from "koishi";
import OpenAI from "openai";
import { z } from "zod";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { ChatMessage, Topic } from "../types.ts";
import { failureMessage } from "../utils/errors.ts";
import { logContext, logDetail } from "../utils/logging.ts";
import { DecisionProvider } from "./decisions.ts";
import { prompts } from "./prompts.ts";
import { AgentRuntime } from "./runtime.ts";
import type { Detection } from "./schemas.ts";
import { detectionSchema, publicationSchema, voiceSchema } from "./schemas.ts";
import { BudgetExceeded, reserveCall } from "./usage.ts";

export class Ai {
  #config: Config;
  #store: Store;
  #decisions: DecisionProvider;
  #voicePrompt: string;
  #runtime: AgentRuntime;
  #logger = new Logger("yanqi:ai");

  constructor(config: Config, store: Store) {
    this.#config = config;
    this.#store = store;
    this.#decisions = new DecisionProvider(config);
    this.#runtime = new AgentRuntime(config, store);

    const persona = config.BOT_PERSONA_FILE
      ? readFileSync(config.BOT_PERSONA_FILE, "utf8").trim()
      : "";
    if (config.BOT_PERSONA_FILE && !persona) {
      throw new Error("BOT_PERSONA_FILE 指定的人设文件不能为空");
    }

    this.#voicePrompt = [
      prompts.voice,
      persona && `角色设定（仅用于表达）：\n${persona}`,
    ]
      .filter(Boolean)
      .join("\n\n");
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

      const accepted = parsed.confidence >= this.#config.DECISION_CONFIDENCE;

      this.#logger.info(
        "%s 独立决策完成：choice=%s confidence=%s accepted=%s 耗时=%s ms",
        label,
        parsed.choice,
        parsed.confidence,
        accepted,
        Math.round(performance.now() - startedAt),
      );

      return accepted ? parsed.choice : null;
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

  public async request(
    state: unknown,
    tools: AgentState["tools"],
  ): Promise<void> {
    const hint = await this.#choose("intent", prompts.intentChoice, state, {
      ...Object.fromEntries(tools.map((tool) => [tool.name, tool.description])),
      chat: "回应对话或记录能力范围内的问题",
      clarify: "请求不明确时请用户说明",
    });

    await this.#runtime.text(
      "intent",
      `${prompts.intent}\n${prompts.memory}`,
      { ...(state as Record<string, unknown>), decisionHint: hint },
      this.#config.AI_INTENT_MODEL ?? this.#config.AI_MODEL,
      tools,
    );
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
      this.#config.AI_DETECT_MODEL ?? this.#config.AI_MODEL,
    );
  }

  public async summarize(
    {
      title,
      description,
      focus,
    }: Pick<Topic, "title" | "description" | "focus">,
    messages: ChatMessage[],
    context: ChatMessage[],
  ): Promise<string> {
    const input = {
      topic: { title, description },
      messages,
      context,
    };

    if (focus) {
      const result = await this.#runtime.json(
        "summary",
        z.object({ markdown: z.string() }),
        `${prompts.summary}\n\n${prompts.focusedSummary}`,
        { ...input, focus },
      );

      return result.markdown.trim();
    }

    return this.#runtime.text(
      "summary",
      `${prompts.summary}\n直接返回纪要正文，不返回 JSON。`,
      input,
    );
  }

  public merge(sections: string[]): Promise<string> {
    return this.#runtime.text("summary_merge", prompts.merge, { sections });
  }

  public async shouldPublish(
    topic: Topic,
    recording: { revision: number; sources: number },
    context: ChatMessage[],
    request: ChatMessage[],
  ): Promise<boolean> {
    const decisionHint = await this.#choose(
      "publish",
      prompts.publishChoice,
      { topic, recording, context, request },
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
          focus: topic.focus,
          directive: topic.directive,
          directiveMessageId:
            topic.directiveMessageId === null
              ? null
              : `m${topic.directiveMessageId}`,
        },
        recording,
        context,
        request,
        decisionHint,
      },
    );

    return result.publish;
  }

  public async voice(
    message: string,
    recentReplies: string[] = [],
  ): Promise<string> {
    const result = await this.#runtime.json(
      "voice",
      voiceSchema,
      this.#voicePrompt,
      { message, recentReplies },
      this.#config.AI_REPLY_MODEL ?? this.#config.AI_MODEL,
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
    const model = this.#config.AI_AUDIO_MODEL;

    if (!model) {
      throw new Error("未配置语音转写模型");
    }

    await reserveCall(this.#config, this.#store, model, "audio");

    const startedAt = performance.now();

    this.#logger.info(
      "%s 语音转写开始：model=%s file=%s",
      logContext.getStore()?.task ?? "",
      model.model,
      path,
    );

    const bytes = await readFile(path);
    const client = new OpenAI({
      apiKey: model.apiKey,
      baseURL: model.baseURL,
      timeout: this.#config.AI_TIMEOUT_MS,
      maxRetries: 0,
    });
    const text = await client.audio.transcriptions.create({
      model: model.model,
      file: await OpenAI.toFile(bytes, path.split(/[\\/]/).at(-1)),
      response_format: "json",
    });

    if (!text.text.trim()) {
      throw new Error("语音转写未返回文字");
    }

    this.#logger.info(
      "%s 语音转写完成：chars=%s 耗时=%s ms",
      logContext.getStore()?.task ?? "",
      text.text.length,
      Math.round(performance.now() - startedAt),
    );

    return text.text;
  }
}
