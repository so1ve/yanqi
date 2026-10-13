import assert from "node:assert/strict";

import { Logger } from "@koishijs/core";
import { Type } from "typebox";

import type { Config } from "../config.ts";
import type { Conversation } from "../storage/conversations.ts";
import type { ChatMessage } from "../types.ts";
import { compactionPrompt } from "./prompts/compaction.ts";
import { conversationPrompt } from "./prompts/conversation.ts";
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

    conversation = await this.#compact(
      conversation,
      JSON.stringify(state).length,
    );
    await context.store.conversations.save(conversation);
    const subagents = new Subagents(this.#runtime, context);

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
        },
      );

      // 只留实际请求与工具交互。最新记忆、权限、任务状态等每次重新加载。
      const lastUser = messages.findLastIndex(
        (message) => message.role === "user",
      );
      const request = messages[lastUser];

      assert.ok(request?.role === "user");
      messages[lastUser] = { ...request, content: input };
      await context.store.conversations.save({ ...conversation, messages });
    } finally {
      await subagents.close();
    }
  }

  async #compact(
    conversation: Conversation,
    inputChars: number,
  ): Promise<Conversation> {
    const budget = this.#config.AI_INPUT_CHARS;
    const { messages, summary } = conversation;

    if (
      messages.length === 0 ||
      JSON.stringify(messages).length + summary.length + inputChars <= budget
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
      { thinking: true },
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
