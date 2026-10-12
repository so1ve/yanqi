import { Type } from "typebox";
import * as Value from "typebox/value";

import type { Config } from "../../config.ts";
import type { DecisionRequest, EvaluateDecision } from "./types.ts";

const responseSchema = Type.Object({
  answers: Type.Record(Type.String(), Type.Unknown()),
});

export async function requestJev(
  config: Config,
  { input, questions }: DecisionRequest,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(config.DECISION_URL, {
    method: "POST",
    redirect: "error",
    headers: {
      "authorization": `Bearer ${config.DECISION_API_KEY}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(config.AI_TIMEOUT_MS),
    ]),
    body: JSON.stringify({
      model: config.DECISION_MODEL,
      state: input,
      questions: Object.fromEntries(
        Object.entries(questions).map(([name, question]) => [
          name,
          { type: "choice", ...question },
        ]),
      ),
    }),
  });

  if (!response.ok) {
    throw new Error(`决策服务请求失败（HTTP ${response.status}）`);
  }

  return response.json();
}

export function readJevAnswers(body: unknown): Record<string, unknown> {
  if (!Value.Check(responseSchema, body)) {
    throw new Error("决策服务返回的 answers 格式不正确");
  }

  return body.answers;
}

export const createJevDecision =
  (config: Config): EvaluateDecision =>
  async (request, signal) =>
    readJevAnswers(await requestJev(config, request, signal));
