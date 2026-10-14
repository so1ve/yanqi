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
    // 与独立决策共用分类含义，仅输出协议不同；修改遵循 prompts/README.md。
    `${instructions}\n<output>逐条分类 candidateIds 中的消息。返回 {"requestIds":["选为 process 的消息 ID"]}，没有时返回 {"requestIds":[]}；其他消息只作上下文。</output>`,
    { ...input, candidateIds },
    { thinking: "high" },
  );

  return result.requestIds;
}
