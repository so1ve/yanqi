import { Type } from "typebox";

import type { ChatMessage, Topic } from "../types.ts";
import { beijingTime } from "../utils/time.ts";
import { prompts } from "./prompts/recording.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { Detection, Publication } from "./schemas.ts";
import { detectionSchema, publicationSchema } from "./schemas.ts";

export class RecordingAI {
  #runtime: AgentRuntime;
  #persona: string;

  constructor(runtime: AgentRuntime, persona: string) {
    this.#runtime = runtime;
    this.#persona = persona;
  }

  public detect(
    messages: ChatMessage[],
    context: ChatMessage[],
    topics: Pick<Topic, "id" | "title" | "description">[],
  ): Promise<Detection> {
    return this.#runtime.json("detect", detectionSchema, prompts.detect, {
      messages,
      context,
      topics,
    });
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
        { thinking: true },
      );

      return result.markdown.trim();
    }

    return this.#runtime.text(
      "summary",
      `${prompts.summary}\n直接返回纪要正文，不返回 JSON。`,
      input,
      { thinking: true },
    );
  }

  public merge(sections: string[]): Promise<string> {
    return this.#runtime.text(
      "summary_merge",
      prompts.merge,
      { sections },
      { thinking: true },
    );
  }

  public choosePublication(
    topic: Topic,
    recording: { revision: number; sources: number; requested: boolean },
    context: ChatMessage[],
    request: ChatMessage[],
    recent: ChatMessage[],
  ): Promise<Publication> {
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

    return this.#runtime.json(
      "publication",
      publicationSchema,
      `${prompts.publication}\n${this.#persona}`,
      input,
    );
  }
}
