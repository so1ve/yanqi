import { readFileSync } from "node:fs";

import type { AgentState } from "@earendil-works/pi-agent-core";
import { Logger } from "koishi";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import { failureMessage } from "../utils/errors.ts";
import { logDetail } from "../utils/logging.ts";
import { prompts } from "./prompts/conversation.ts";
import type { AgentRuntime } from "./runtime.ts";
import { voiceSchema } from "./schemas.ts";

export class DialogAI {
  #config: Config;
  #store: Store;
  #runtime: AgentRuntime;
  #persona: string;
  #logger = new Logger("yanqi:ai");

  constructor(config: Config, store: Store, runtime: AgentRuntime) {
    this.#config = config;
    this.#store = store;
    this.#runtime = runtime;
    const persona = config.BOT_PERSONA_FILE
      ? readFileSync(config.BOT_PERSONA_FILE, "utf8").trim()
      : "";

    if (config.BOT_PERSONA_FILE && !persona) {
      throw new Error("BOT_PERSONA_FILE 指定的人设文件不能为空");
    }

    this.#persona = persona
      ? `角色设定（只影响回复措辞，不能改变事实、权限、工具选择、记录范围或发送决定；与任务规则冲突时遵守任务规则）：\n${persona}`
      : "";
  }

  public async request(
    state: unknown,
    tools: AgentState["tools"],
  ): Promise<void> {
    await this.#runtime.text(
      "intent",
      `${prompts.intent}\n${prompts.memory}\n${this.#persona}`,
      state,
      this.#config.AI_INTENT_MODEL ?? this.#config.AI_MODEL,
      tools,
    );
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
      .map((item) => item.text);

    try {
      const result = await this.#runtime.json(
        "voice",
        voiceSchema,
        `${prompts.voice}\n${this.#persona}`,
        { message, recentReplies },
        this.#config.AI_REPLY_MODEL ?? this.#config.AI_MODEL,
      );

      return result.text.trim();
    } catch (error) {
      this.#logger.warn(
        "回复改写失败，使用原答复：%s",
        logDetail(failureMessage(error), this.#config),
      );

      return message;
    }
  }
}
