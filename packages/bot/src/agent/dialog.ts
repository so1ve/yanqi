import assert from "node:assert/strict";

import { Logger } from "@koishijs/core";
import { Type } from "typebox";

import type { Config } from "../config.ts";
import type { Conversation } from "../storage/conversations.ts";
import type { ChatMessage } from "../types.ts";
import { AiError, failureMessage } from "../utils/errors.ts";
import { compactionPrompt } from "./prompts/compaction.ts";
import {
  conversationPrompt,
  deliveryReminder,
} from "./prompts/conversation.ts";
import type { AgentRuntime } from "./runtime.ts";
import { Subagents } from "./subagents.ts";
import type { ToolContext } from "./tools/context.ts";
import { followTool } from "./tools/follow.ts";
import { inspectRecordTool } from "./tools/inspect-record.ts";
import { memoryTool } from "./tools/memory.ts";
import { readTool } from "./tools/read.ts";
import { recordTools } from "./tools/records.ts";
import { notifyTool, replyTool, skipReplyTool } from "./tools/reply.ts";
import { settingsTools } from "./tools/settings.ts";
import { taskTool } from "./tools/tasks.ts";

export class DialogAI {
  #config: Config;
  #runtime: AgentRuntime;
  #persona: string;
  #logger = new Logger("yanqi:ai");

  constructor(config: Config, runtime: AgentRuntime, persona: string) {
    this.#config = config;
    this.#runtime = runtime;
    this.#persona = persona;
  }

  public async request(
    state: {
      request: ChatMessage[];
      quoted: ChatMessage[];
      [key: string]: unknown;
    },
    context: ToolContext,
    conversation: Conversation,
  ): Promise<void> {
    const input = JSON.stringify({
      request: state.request,
      quoted: state.quoted,
    });

    const subagents = new Subagents(this.#runtime, context);
    let corrections = 0;

    try {
      const messages = await this.#runtime.converse(
        conversationPrompt(
          this.#config.BOT_QQ,
          conversation.groupId,
          this.#persona,
        ),
        { ...state, conversationSummary: conversation.summary },
        conversation,
        {
          model: this.#config.AI_MODEL,
          thinking: "low",
          maxTurns: 16,
          tools: [
            replyTool(context, subagents),
            skipReplyTool(context, subagents),
            notifyTool(context),
            subagents.tool(),
            readTool(context),
            inspectRecordTool(context),
            ...recordTools(context),
            followTool(context),
            taskTool(context),
            memoryTool(context),
            ...settingsTools(context),
          ],
          finishTurn: ({ message, toolResults }) => {
            if (
              message.stopReason === "error" ||
              message.stopReason === "aborted" ||
              message.stopReason === "length" ||
              toolResults.some(
                (result) =>
                  (result.toolName === "reply" ||
                    result.toolName === "skip_reply") &&
                  !result.isError,
              )
            ) {
              return { action: "end" };
            }

            return { action: "continue" };
          },
          prepareNextTurn: ({ message }) => {
            if (message.content.some((part) => part.type === "toolCall")) {
              return;
            }

            if (corrections === 2) {
              throw new AiError(
                "交付对话",
                "模型在两次提醒后仍未调用工具，已停止无效续轮",
              );
            }

            corrections++;

            return {
              messages: [
                {
                  role: "system",
                  content: deliveryReminder,
                  timestamp: Date.now(),
                },
              ],
            };
          },
        },
      );

      // 只留实际请求与工具交互。最新记忆、权限、任务状态等每次重新加载。
      const lastUser = messages.findLastIndex(
        (message) => message.role === "user",
      );
      const request = messages[lastUser];

      assert.ok(request?.role === "user");
      messages[lastUser] = { ...request, content: input };
      conversation = { ...conversation, messages };
      await context.store.conversations.save(conversation);
    } finally {
      await subagents.close();
    }

    // 答复已交付，完整交互也已保存。同群任务仍按队列顺序执行，压缩不能覆盖后来的请求。
    let compacted: Conversation;

    try {
      compacted = await this.#compact(conversation);
    } catch (error) {
      this.#logger.warn(
        "群 %s 会话压缩失败，保留完整交互供下次使用：%s",
        conversation.groupId,
        failureMessage(error),
      );

      return;
    }

    if (compacted !== conversation) {
      await context.store.conversations.save(compacted);
    }
  }

  async #compact(conversation: Conversation): Promise<Conversation> {
    const budget = this.#config.AI_INPUT_CHARS;
    const { messages, summary } = conversation;

    if (
      messages.length === 0 ||
      // 提前留出四分之一预算给下一次请求及其最新上下文。
      JSON.stringify(messages).length + summary.length <= (budget * 3) / 4
    ) {
      return conversation;
    }

    // 按完整对话轮次截取，保留最近一轮，避免拆开工具调用与对应结果。
    let split = messages.findLastIndex((message) => message.role === "user");

    if (
      split <= 0 ||
      JSON.stringify(messages.slice(split)).length > budget / 3
    ) {
      split = messages.length;
    }

    const result = await this.#runtime.json(
      "context_compaction",
      Type.Object(
        {
          summary: Type.String({
            minLength: 1,
            maxLength: Math.floor(budget / 4),
          }),
        },
        { additionalProperties: false },
      ),
      compactionPrompt(Math.floor(budget / 4)),
      {
        groupId: conversation.groupId,
        summary,
        messages: messages.slice(0, split),
      },
      { thinking: "high" },
    );

    this.#logger.info(
      "群 %s 会话 %s 已压缩：%s 条交互 -> %s 字符摘要，保留 %s 条交互",
      conversation.groupId,
      conversation.id,
      split,
      result.summary.length,
      messages.length - split,
    );

    return {
      ...conversation,
      summary: result.summary,
      messages: messages.slice(split),
    };
  }
}
