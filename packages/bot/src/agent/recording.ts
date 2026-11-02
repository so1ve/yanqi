import { Type } from "typebox";

import type { Config } from "../config.ts";
import { contextInputBudget } from "../config.ts";
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
import { recallMemoryTool } from "./tools/memory.ts";
import { AiSizeError } from "./usage.ts";

export class RecordingAI {
  #config: Config;
  #runtime: AgentRuntime;
  #persona: string;
  #store: Store;
  #sourceRules: string;

  constructor(
    config: Config,
    runtime: AgentRuntime,
    persona: string,
    store: Store,
  ) {
    this.#config = config;
    this.#runtime = runtime;
    this.#persona = persona;
    this.#store = store;
    this.#sourceRules = chatSourceRules(config.BOT_QQ);
  }

  public detect(
    messages: ChatMessage[],
    context: ChatMessage[],
    topics: Pick<Topic, "id" | "title" | "description">[],
  ): Promise<Detection> {
    return this.#runtime.json(
      "detect",
      detectionSchema(
        [...new Set([...messages, ...context].map((message) => message.id))],
        topics.map((topic) => topic.id),
      ),
      `${prompts.detect}\n${this.#sourceRules}`,
      {
        messages,
        context,
        topics,
      },
    );
  }

  public async prepareSummary(topic: Topic) {
    const input = {
      topic: { title: topic.title, description: topic.description },
      focus: topic.focus,
      memory: await this.#summaryMemory(topic),
    };
    const rules = `${this.#sourceRules}\n${summaryPrompts.memoryUse}`;
    const summarize = `${summaryPrompts.summarize}\n${rules}`;
    const merge = `${summaryPrompts.merge}\n${rules}`;
    // 中文按每字符一个 token 留预算，另给引用上下文和协议字段留空间。
    // 整理使用模型上下文容量，不受闲聊的 AI_INPUT_CHARS 分片限制。
    const contextChars = 4096;
    const inputChars =
      contextInputBudget(this.#config) -
      Math.max(summarize.length, merge.length + summaryPrompts.reduce.length) -
      JSON.stringify(input).length -
      contextChars -
      512;

    if (inputChars < 1000) {
      throw new AiSizeError("模型上下文不足以容纳整理要求、记忆和原文");
    }

    return {
      inputChars,
      contextChars,
      summarize: async (messages: ChatMessage[], context: ChatMessage[]) => {
        const result = await this.#runtime.json(
          "summary",
          Type.Object(
            { markdown: Type.String() },
            { additionalProperties: false },
          ),
          summarize,
          { messages, context, ...input },
          { thinking: "low" },
        );

        return result.markdown.trim();
      },
      merge: (sections: string[], targetChars?: number) =>
        this.#runtime.text(
          "summary_merge",
          `${merge}\n${targetChars === undefined ? "" : summaryPrompts.reduce}`,
          {
            sections,
            ...input,
            ...(targetChars === undefined ? {} : { targetChars }),
          },
          { thinking: "low" },
        ),
    };
  }

  async #summaryMemory(topic: Topic) {
    const memory = await this.#store.memories.index(
      topic.groupId,
      topic.ownerId,
    );
    const keys = (entries: typeof memory.group) =>
      entries.length === 0
        ? Type.Array(Type.String(), { maxItems: 0 })
        : Type.Array(
            Type.Enum(
              entries.map((entry) => entry.key),
              { type: "string" },
            ),
            { uniqueItems: true },
          );
    const selected =
      memory.group.length + memory.user.length === 0
        ? { group: [], user: [] }
        : await this.#runtime.json(
            "summary_memory",
            Type.Object(
              { group: keys(memory.group), user: keys(memory.user) },
              { additionalProperties: false },
            ),
            summaryPrompts.memory,
            {
              topic: { title: topic.title, description: topic.description },
              focus: topic.focus,
              memory,
            },
            { thinking: "low" },
          );
    const [group, user] = await Promise.all([
      selected.group.length === 0
        ? []
        : this.#store.memories.read(
            { scope: "group", ownerId: topic.groupId },
            selected.group,
          ),
      selected.user.length === 0
        ? []
        : this.#store.memories.read(
            { scope: "user", ownerId: topic.ownerId! },
            selected.user,
          ),
    ]);

    return {
      group: group.map(({ key, content }) => ({ key, content })),
      user: user.map(({ key, content }) => ({ key, content })),
    };
  }

  public async choosePublication(
    records: {
      topic: Topic;
      revision: number | null;
      sources: number;
      requested: boolean;
    }[],
    context: ChatMessage[],
    request: ChatMessage[],
    recent: ChatMessage[],
  ): Promise<Publication> {
    const groupId = records[0]!.topic.groupId;
    const userId = request[0]?.userId ?? records[0]!.topic.ownerId;
    const input = {
      records: records.map(({ topic, ...record }) => ({
        ...record,
        state: record.revision === null ? "failed" : "saved",
        title: topic.title,
        description: topic.description,
        focus: topic.focus,
        directive: topic.directive,
        directiveMessageId:
          topic.directiveMessageId === null
            ? null
            : `m${topic.directiveMessageId}`,
      })),
      context,
      request,
      recent,
      memory: await this.#store.memories.index(groupId, userId),
      now: beijingTime(Date.now()),
    };

    return this.#runtime.json(
      "publication",
      publicationSchema,
      `${prompts.publication}\n${this.#sourceRules}\n${summaryMemory}\n${this.#persona}`,
      input,
      { tools: [recallMemoryTool(this.#store, groupId, userId)] },
    );
  }
}
