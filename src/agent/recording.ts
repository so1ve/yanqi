import { Type } from "typebox";

import type { Config } from "../config.ts";
import type { ChatMessage, Topic } from "../types.ts";
import { beijingTime } from "../utils/time.ts";
import type { Decisions } from "./decisions/index.ts";
import { prompts } from "./prompts/recording.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { Detection } from "./schemas.ts";
import { detectionSchema } from "./schemas.ts";

export class RecordingAI {
  #config: Config;
  #runtime: AgentRuntime;
  #decisions: Decisions;

  constructor(config: Config, runtime: AgentRuntime, decisions: Decisions) {
    this.#config = config;
    this.#runtime = runtime;
    this.#decisions = decisions;
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
        Type.Object(
          { markdown: Type.String() },
          { additionalProperties: false },
        ),
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

  public choosePublication(
    topic: Topic,
    recording: { revision: number; sources: number; requested: boolean },
    context: ChatMessage[],
    request: ChatMessage[],
    recent: ChatMessage[],
  ): Promise<"send" | "notify" | "silent"> {
    const input = {
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
      recent,
      now: beijingTime(Date.now()),
    };

    return this.#decisions.choosePublication(input);
  }
}
