import { Type } from "typebox";

import type { AgentRuntime } from "../runtime.ts";

export async function selectRequests(
  runtime: AgentRuntime,
  instructions: string,
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
    `${instructions}\n只判断 candidateIds 中的消息，其他消息仅作上下文。返回 {"requestIds":["需要小栖回应或处理的消息 ID"]}；没有此类消息时返回空数组。`,
    { ...input, candidateIds },
    { thinking: "high" },
  );

  return result.requestIds;
}
