import { Type } from "typebox";

import type { Store } from "../storage/store.ts";
import type { ChatMessage, Topic } from "../types.ts";
import { beijingTime } from "../utils/time.ts";
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

  constructor(runtime: AgentRuntime, persona: string, store: Store) {
    this.#runtime = runtime;
    this.#persona = persona;
    this.#store = store;
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
    topic: Topic,
    messages: ChatMessage[],
    context: ChatMessage[],
  ): Promise<string> {
    const { title, description, focus } = topic;
    const input = {
      topic: { title, description },
      messages,
      context,
      memory: await this.#store.memories.context(topic.groupId, topic.ownerId),
    };

    if (focus) {
      const result = await this.#runtime.json(
        "summary",
        Type.Object(
          { markdown: Type.String() },
          { additionalProperties: false },
        ),
        `${summaryPrompts.summarize}\n\n${summaryPrompts.focusedSummary}\n${summaryMemory}`,
        { ...input, focus },
        { thinking: true },
      );

      return result.markdown.trim();
    }

    return this.#runtime.text(
      "summary",
      `${summaryPrompts.summarize}\n${summaryMemory}\n直接返回纪要正文，不返回 JSON。`,
      input,
      { thinking: true },
    );
  }

  public async merge(topic: Topic, sections: string[]): Promise<string> {
    return this.#runtime.text(
      "summary_merge",
      `${summaryPrompts.merge}\n${summaryMemory}`,
      {
        sections,
        memory: await this.#store.memories.context(
          topic.groupId,
          topic.ownerId,
        ),
      },
      { thinking: true },
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
      `${prompts.publication}\n${this.#persona}`,
      input,
    );
  }
}
