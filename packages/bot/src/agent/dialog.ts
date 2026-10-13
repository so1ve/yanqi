import type { Config } from "../config.ts";
import { prompts } from "./prompts/conversation.ts";
import type { AgentRuntime } from "./runtime.ts";
import { Subagents } from "./subagents.ts";
import type { ToolContext } from "./tools/context.ts";
import { followTool } from "./tools/follow.ts";
import { inspectRecordTool } from "./tools/inspect-record.ts";
import { memoryTool } from "./tools/memory.ts";
import { readTool } from "./tools/read.ts";
import { recordTools } from "./tools/records.ts";
import { notifyTool, replyTool } from "./tools/reply.ts";
import { settingsTools } from "./tools/settings.ts";
import { taskTool } from "./tools/tasks.ts";

export class DialogAI {
  #config: Config;
  #runtime: AgentRuntime;
  #persona: string;

  constructor(config: Config, runtime: AgentRuntime, persona: string) {
    this.#config = config;
    this.#runtime = runtime;
    this.#persona = persona;
  }

  public async request(state: unknown, context: ToolContext): Promise<void> {
    const subagents = new Subagents(this.#runtime, context);

    try {
      await this.#runtime.text(
        "intent",
        `${prompts.intent}\n${prompts.memory}\n${this.#persona}`,
        state,
        {
          model: this.#config.AI_MODEL,
          maxTurns: 16,
          tools: [
            replyTool(context, subagents),
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
                (result) => result.toolName === "reply" && !result.isError,
              )
            ) {
              return { action: "end" };
            }

            return { action: "continue" };
          },
        },
      );
    } finally {
      await subagents.close();
    }
  }
}
