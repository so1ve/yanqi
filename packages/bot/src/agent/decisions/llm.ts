import { Type } from "typebox";

import type { AgentRuntime } from "../runtime.ts";
import type { MessageSelection } from "./types.ts";

export async function selectMessages(
  runtime: AgentRuntime,
  instructions: string,
  input: Record<string, unknown>,
  candidateIds: string[],
  memoryOnly: boolean,
): Promise<MessageSelection> {
  const ids = Type.Array(Type.Enum(candidateIds, { type: "string" }), {
    uniqueItems: true,
  });
  const result = await runtime.json(
    "observe",
    Type.Object(
      {
        requestIds: memoryOnly
          ? Type.Array(Type.String(), { maxItems: 0 })
          : ids,
        memoryIds: ids,
      },
      { additionalProperties: false },
    ),
    // 与独立决策共用分类含义，仅输出协议不同；修改遵循 prompts/README.md。
    `${instructions}\n<output>逐条分类 candidateIds 中的消息。requestIds 放选为 process 的 ID，memoryIds 放选为 memory 的 ID，ignore 不列入。每个 ID 只进一个数组；没有时返回空数组。其他消息只作上下文。</output>`,
    { ...input, candidateIds },
    { thinking: "high" },
  );

  if (result.requestIds.some((id) => result.memoryIds.includes(id))) {
    throw new Error("同一消息不能同时分配为回复请求和静默记忆");
  }

  return result;
}
