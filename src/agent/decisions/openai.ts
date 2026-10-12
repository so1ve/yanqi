import OpenAI from "openai";

import type { Config } from "../../config.ts";
import type { EvaluateDecision } from "./types.ts";

export function createOpenAIDecision(config: Config): EvaluateDecision {
  const client = new OpenAI({
    apiKey: config.DECISION_API_KEY,
    baseURL: config.DECISION_URL,
    timeout: config.AI_TIMEOUT_MS,
    maxRetries: 0,
  });

  return async ({ input, instructions, criteria }) => {
    const result = await client.decisions.create({
      model: config.DECISION_MODEL,
      input,
      questions: [
        {
          type: "choice",
          name: "action",
          instructions,
          choices: Object.entries(criteria).map(([value, description]) => ({
            value,
            description,
          })),
        },
      ],
    });

    return result.answers.find((item) => item.name === "action");
  };
}
