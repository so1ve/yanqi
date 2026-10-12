import { z } from "zod";

import type { Config } from "../config.ts";
import type { ChatMessage, Topic } from "../types.ts";
import { beijingTime } from "../utils/time.ts";
import type { DecisionProvider } from "./decisions.ts";
import { prompts } from "./prompts/recording.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { Detection } from "./schemas.ts";
import { detectionSchema, publicationSchema } from "./schemas.ts";

export class RecordingAI {
  #config: Config;
  #runtime: AgentRuntime;
  #decisions: DecisionProvider;

  constructor(
    config: Config,
    runtime: AgentRuntime,
    decisions: DecisionProvider,
  ) {
    this.#config = config;
    this.#runtime = runtime;
    this.#decisions = decisions;
  }

  public async observe(
    messages: ChatMessage[],
    context: ChatMessage[],
  ): Promise<{ messageIds: string[]; replyIds: string[] }> {
    const replyIds = [
      ...new Set(
        messages
          .filter((message) => !message.command && !message.isBot)
          .map((message) => message.id),
      ),
    ];
    const result = await this.#runtime.json(
      "observe",
      z.object({
        messageIds: z.array(
          z.enum([
            ...new Set(
              [...messages, ...context]
                .filter((message) => !message.isBot)
                .map((message) => message.id),
            ),
          ]),
        ),
        replyIds:
          replyIds.length > 0
            ? z.array(z.enum(replyIds))
            : z.array(z.string()).max(0),
      }),
      prompts.observe,
      {
        messages,
        context,
        self: { userId: this.#config.BOT_QQ, names: ["言栖", "小栖"] },
      },
      this.#config.AI_DETECT_MODEL ?? this.#config.AI_MODEL,
    );

    return result;
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
        z.object({ markdown: z.string() }),
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

  public async choosePublication(
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
    const decisionHint = await this.#decisions.choose(
      "publish",
      prompts.publishChoice,
      input,
      {
        send: "用户需要这份纪要，或发送有助于当前话题的讨论",
        notify: "用户正在等保存结果，或简短告知新记录有助于当前讨论；不发全文",
        silent: "补整理旧聊天、后台更新或当前已无须通知，只保存在本地",
      },
    );

    const result = await this.#runtime.json(
      "publication",
      publicationSchema,
      prompts.publication,
      { ...input, decisionHint },
    );

    return result.action;
  }
}
