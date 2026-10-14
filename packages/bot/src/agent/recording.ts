import { Type } from "typebox";

import type { Store } from "../storage/store.ts";
import type { ChatMessage, Topic } from "../types.ts";
import { beijingTime } from "../utils/time.ts";
import { chatSourceRules } from "./prompts/common.ts";
import { summaryMemory } from "./prompts/memory.ts";
import { prompts } from "./prompts/recording.ts";
import { summaryPrompts } from "./prompts/summary.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { Detection, Publication } from "./schemas.ts";
import { detectionSchema, publicationSchema } from "./schemas.ts";

export class RecordingAI {
  #runtime: AgentRuntime;
  #persona: string;
  #store: Store;
  #sourceRules: string;

  constructor(
    runtime: AgentRuntime,
    persona: string,
    store: Store,
    botId: string,
  ) {
    this.#runtime = runtime;
    this.#persona = persona;
    this.#store = store;
    this.#sourceRules = chatSourceRules(botId);
  }

  public detect(
    messages: ChatMessage[],
    context: ChatMessage[],
    topics: Pick<Topic, "id" | "title" | "description">[],
  ): Promise<Detection> {
    return this.#runtime.json(
      "detect",
      detectionSchema,
      `${prompts.detect}\n${this.#sourceRules}`,
      {
        messages,
        context,
        topics,
      },
    );
  }

  public async summarize(
    topic: Topic,
    messages: ChatMessage[],
    context: ChatMessage[],
  ): Promise<string> {
    const { title, description, focus } = topic;
    const result = await this.#runtime.json(
      "summary",
      Type.Object({ markdown: Type.String() }, { additionalProperties: false }),
      `${summaryPrompts.summarize}\n${this.#sourceRules}\n${summaryMemory}`,
      {
        topic: { title, description },
        focus,
        messages,
        context,
        memory: await this.#store.memories.context(
          topic.groupId,
          topic.ownerId,
        ),
      },
      { thinking: "high" },
    );

    return result.markdown.trim();
  }

  public async merge(topic: Topic, sections: string[]): Promise<string> {
    return this.#runtime.text(
      "summary_merge",
      `${summaryPrompts.merge}\n${this.#sourceRules}\n${summaryMemory}`,
      {
        topic: { title: topic.title, description: topic.description },
        focus: topic.focus,
        sections,
        memory: await this.#store.memories.context(
          topic.groupId,
          topic.ownerId,
        ),
      },
      { thinking: "high" },
    );
  }

  public async choosePublication(
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
      memory: await this.#store.memories.context(
        topic.groupId,
        request[0]?.userId ?? topic.ownerId,
      ),
      now: beijingTime(Date.now()),
    };

    return this.#runtime.json(
      "publication",
      publicationSchema,
      `${prompts.publication}\n${this.#sourceRules}\n${this.#persona}`,
      input,
    );
  }
}
