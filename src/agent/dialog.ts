import { readFileSync } from "node:fs";

import type { AgentState } from "@earendil-works/pi-agent-core";
import { Logger } from "koishi";
import { z } from "zod";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { ChatMessage } from "../types.ts";
import { failureMessage } from "../utils/errors.ts";
import { logDetail } from "../utils/logging.ts";
import type { DecisionProvider } from "./decisions.ts";
import { MAX_REPLY_CHARS } from "./prompts/common.ts";
import { prompts } from "./prompts/conversation.ts";
import type { AgentRuntime } from "./runtime.ts";
import { voiceSchema } from "./schemas.ts";

export class DialogAI {
  #config: Config;
  #store: Store;
  #runtime: AgentRuntime;
  #decisions: DecisionProvider;
  #voicePrompt: string;
  #logger = new Logger("yanqi:ai");

  constructor(
    config: Config,
    store: Store,
    runtime: AgentRuntime,
    decisions: DecisionProvider,
  ) {
    this.#config = config;
    this.#store = store;
    this.#runtime = runtime;
    this.#decisions = decisions;
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

  public async request(
    state: unknown,
    tools: AgentState["tools"],
  ): Promise<void> {
    const hint = await this.#decisions.choose(
      "intent",
      prompts.intentChoice,
      state,
      {
        ...Object.fromEntries(
          tools.map((tool) => [tool.name, tool.description]),
        ),
        chat: "回应对话或记录能力范围内的问题",
        clarify: "请求不明确时请用户说明",
      },
    );

    await this.#runtime.text(
      "intent",
      `${prompts.intent}\n${prompts.memory}`,
      { ...(state as Record<string, unknown>), decisionHint: hint },
      this.#config.AI_INTENT_MODEL ?? this.#config.AI_MODEL,
      tools,
    );
  }

  public async relevantContext(
    request: ChatMessage[],
    context: ChatMessage[],
  ): Promise<ChatMessage[]> {
    if (!this.#config.AI_DETECT_MODEL || context.length === 0) {
      return context;
    }

    const result = await this.#runtime.json(
      "context_filter",
      z.object({
        messageIds: z.array(
          z.enum([...new Set(context.map((message) => message.id))]),
        ),
      }),
      prompts.contextFilter,
      { request, context },
      this.#config.AI_DETECT_MODEL,
    );
    const keep = new Set(result.messageIds);

    return context.filter((message) => keep.has(message.id));
  }

  public async voice(groupId: string, message: string): Promise<string> {
    const recentReplies = (
      await this.#store.messages.conversation(
        groupId,
        12,
        Number.MAX_SAFE_INTEGER,
      )
    )
      .filter((item) => item.isBot && item.noteId === null)
      .slice(-3)
      .map((item) => item.text.slice(0, MAX_REPLY_CHARS));

    try {
      const result = await this.#runtime.json(
        "voice",
        voiceSchema,
        this.#voicePrompt,
        { message, recentReplies },
        this.#config.AI_REPLY_MODEL ?? this.#config.AI_MODEL,
      );

      return result.text;
    } catch (error) {
      if (message.length > MAX_REPLY_CHARS) {
        throw error;
      }

      this.#logger.warn(
        "回复改写失败，使用原答复：%s",
        logDetail(failureMessage(error), this.#config),
      );

      return message;
    }
  }
}
