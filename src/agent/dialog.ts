import type { AgentState } from "@earendil-works/pi-agent-core";

import type { Config } from "../config.ts";
import { prompts } from "./prompts/conversation.ts";
import type { AgentRuntime } from "./runtime.ts";

export class DialogAI {
  #config: Config;
  #runtime: AgentRuntime;
  #persona: string;

  constructor(config: Config, runtime: AgentRuntime, persona: string) {
    this.#config = config;
    this.#runtime = runtime;
    this.#persona = persona;
  }

  public async request(
    state: unknown,
    tools: AgentState["tools"],
  ): Promise<void> {
    await this.#runtime.text(
      "intent",
      `${prompts.intent}\n${prompts.memory}\n${this.#persona}`,
      state,
      this.#config.AI_MODEL,
      tools,
    );
  }
}
