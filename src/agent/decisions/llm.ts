import { prompts } from "../prompts/recording.ts";
import type { AgentRuntime } from "../runtime.ts";
import { publicationSchema } from "../schemas.ts";

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
