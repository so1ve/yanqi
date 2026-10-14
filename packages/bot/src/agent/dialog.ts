import assert from "node:assert/strict";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  estimateContextTokens,
  estimateMessageTokens,
  estimateTextTokens,
} from "@earendil-works/pi-ai/utils/estimate";
import { Logger } from "@koishijs/core";
import { Type } from "typebox";

import type { Config } from "../config.ts";
import { contextInputBudget } from "../config.ts";
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
import {
  hasBackgroundDelivery,
  notifyTool,
  replyTool,
  skipReplyTool,
} from "./tools/reply.ts";
import { settingsTools } from "./tools/settings.ts";
import { taskTool } from "./tools/tasks.ts";

// 记忆每轮按需读取，旧详情及写入参数不随持续会话重复注入。
const withoutMemoryDetails = (messages: AgentMessage[]): AgentMessage[] =>
  messages.flatMap<AgentMessage>((message) => {
    if (message.role === "toolResult" && message.toolName === "memory") {
      return [];
    }

    if (message.role === "assistant") {
      const content = message.content.filter(
        (part) => part.type !== "toolCall" || part.name !== "memory",
      );

      return content.length > 0 ? [{ ...message, content }] : [];
    }

    return [message];
  });

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
        {
          ...conversation,
          messages: withoutMemoryDetails(conversation.messages),
        },
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
          beforeToolCall: async ({ assistantMessage, toolCall }) => {
            // 同轮工具按顺序执行；即使模型把回复排在整理之前，也不提前播报。
            if (
              (toolCall.name === "reply" || toolCall.name === "notify") &&
              assistantMessage.content.some(
                (part) =>
                  part.type === "toolCall" &&
                  (part.name === "record" ||
                    (part.name === "edit_record" &&
                      part.arguments.action !== "hold") ||
                    (part.name === "follow" &&
                      part.arguments.action === "stop") ||
                    (part.name === "task" &&
                      (part.arguments.action === "retry" ||
                        part.arguments.action === "retry_failed"))),
              )
            ) {
              return {
                block: true,
                reason:
                  "本轮先执行纪要操作，结果由后台统一交付。操作失败时再根据错误处理。",
              };
            }

            return undefined;
          },
          finishTurn: async ({ message, toolResults }) => {
            if (
              message.stopReason === "error" ||
              message.stopReason === "aborted" ||
              message.stopReason === "length"
            ) {
              return { action: "end" };
            }

            // 真正的操作错误仍交回模型修正，不能被同轮的结束工具掩盖。
            if (
              toolResults.some(
                (result) =>
                  result.isError &&
                  !["notify", "reply", "skip_reply"].includes(result.toolName),
              )
            ) {
              return { action: "continue" };
            }

            if (
              (await hasBackgroundDelivery(context)) ||
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
      conversation = {
        ...conversation,
        messages: withoutMemoryDetails(messages),
      };
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
    const budget = contextInputBudget(this.#config);
    const { messages, summary } = conversation;
    // 优先使用服务返回的 token 用量，包含系统提示词、工具、缓存和本轮输出。
    const estimate = estimateContextTokens(messages);
    const usedTokens =
      estimate.tokens +
      (estimate.lastUsageIndex === null ? estimateTextTokens(summary) : 0);

    if (
      messages.length === 0 ||
      // 提前留出四分之一预算给下一次请求及其最新上下文。
      usedTokens <= (budget * 3) / 4
    ) {
      return conversation;
    }

    // 按完整对话轮次截取，保留最近一轮，避免拆开工具调用与对应结果。
    let split = messages.findLastIndex((message) => message.role === "user");

    if (
      split <= 0 ||
      messages
        .slice(split)
        .reduce(
          (tokens, message) => tokens + estimateMessageTokens(message),
          0,
        ) >
        budget / 3
    ) {
      split = messages.length;
    }

    // 调大上下文用于保留更多原始轮次，压缩摘要仍保持紧凑。
    const maxChars = Math.floor(this.#config.AI_INPUT_CHARS / 4);
    const result = await this.#runtime.json(
      "context_compaction",
      Type.Object(
        {
          summary: Type.String({
            minLength: 1,
            maxLength: maxChars,
          }),
        },
        { additionalProperties: false },
      ),
      compactionPrompt(maxChars),
      {
        groupId: conversation.groupId,
        summary,
        messages: messages.slice(0, split),
      },
      { thinking: "high" },
    );

    this.#logger.info(
      "群 %s 会话 %s 已压缩：上下文约 %s/%s token，%s 条交互 -> %s 字符摘要，保留 %s 条交互",
      conversation.groupId,
      conversation.id,
      usedTokens,
      this.#config.AI_CONTEXT_TOKENS,
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
