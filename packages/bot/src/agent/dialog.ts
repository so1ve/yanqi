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
import type { Store } from "../storage/store.ts";
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
  #compacting = new Set<string>();

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
            notifyTool(context, subagents),
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
                  "先执行实际操作。耗时操作的接手提示放在该工具的 progress 参数中，成功安排后再发送；最终结果由后台统一交付。操作失败时按错误处理。",
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
      conversation = await context.store.conversations.append(
        conversation,
        withoutMemoryDetails(messages.slice(lastUser)),
      );
    } finally {
      await subagents.close();
    }

    // 回复已交付后再压缩，同群其他请求继续执行；每群只运行一次压缩。
    if (this.#compacting.has(conversation.groupId)) {
      return;
    }

    this.#compacting.add(conversation.groupId);
    try {
      await this.#compact(conversation, context.store);
    } catch (error) {
      this.#logger.warn(
        "群 %s 会话压缩失败，保留完整交互供下次使用：%s",
        conversation.groupId,
        failureMessage(error),
      );
    } finally {
      this.#compacting.delete(conversation.groupId);
    }
  }

  async #compact(conversation: Conversation, store: Store): Promise<void> {
    const budget = contextInputBudget(this.#config);
    const { messages, summary } = conversation;
    const estimate = estimateContextTokens(messages);
    // 服务用量包含提示词和工具；并行完成的其他轮次还需按合并后的内容估算。
    const usedTokens = Math.max(
      estimate.tokens +
        (estimate.lastUsageIndex === null ? estimateTextTokens(summary) : 0),
      estimateTextTokens(summary) +
        messages.reduce(
          (tokens, message) => tokens + estimateMessageTokens(message),
          0,
        ),
    );

    if (
      messages.length === 0 ||
      // 提前留出四分之一预算给下一次请求及其最新上下文。
      usedTokens <= (budget * 3) / 4
    ) {
      return;
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

    const saved = await store.conversations.compact(
      conversation,
      result.summary,
      messages.slice(split),
    );

    if (!saved) {
      return;
    }

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
  }
}
