import { Type } from "typebox";

import { prompts as conversationPrompts } from "../prompts/conversation.ts";
import type { AgentRuntime } from "../runtime.ts";

export async function recordingRequests(
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
  );

  return result.requestIds;
}
