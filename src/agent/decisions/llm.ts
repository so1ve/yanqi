import { Type } from "typebox";

import type { Config } from "../../config.ts";
import { prompts as conversationPrompts } from "../prompts/conversation.ts";
import { prompts } from "../prompts/recording.ts";
import type { AgentRuntime } from "../runtime.ts";
import { publicationSchema } from "../schemas.ts";

export async function recordingRequests(
  config: Config,
  runtime: AgentRuntime,
  input: Record<string, unknown>,
  candidateIds: string[],
): Promise<string[]> {
  const result = await runtime.json(
    "observe",
    Type.Object(
      {
        requestIds: Type.Array(Type.Enum(candidateIds, { type: "string" })),
      },
      { additionalProperties: false },
    ),
    `${conversationPrompts.recordingRequests}\n只判断 candidateIds 中的消息，其他消息仅作上下文。返回 {"requestIds":["选中的消息 ID"]}；没有记录请求时返回空数组。`,
    { ...input, candidateIds },
    config.AI_DETECT_MODEL ?? config.AI_MODEL,
  );

  return result.requestIds;
}

export async function choosePublication(
  runtime: AgentRuntime,
  input: Record<string, unknown>,
  decisionHint: string | null,
) {
  const result = await runtime.json(
    "publication",
    publicationSchema,
    prompts.publication,
    { ...input, decisionHint },
  );

  return result.action;
}
