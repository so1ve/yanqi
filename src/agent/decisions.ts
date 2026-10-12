import OpenAI from "openai";
import { z } from "zod";

import type { Config } from "../config.ts";

export class DecisionProvider {
  #config: Config;
  #client: OpenAI | null;

  constructor(config: Config) {
    this.#config = config;
    this.#client =
      config.DECISION_PROVIDER === "openai" ||
      config.DECISION_PROVIDER === "vercel"
        ? new OpenAI({
            apiKey: config.DECISION_API_KEY,
            baseURL: config.DECISION_URL,
            timeout: config.AI_TIMEOUT_MS,
            maxRetries: 0,
          })
        : null;
  }

  public async evaluate(
    input: string,
    instructions: string,
    criteria: Record<string, string>,
  ): Promise<unknown> {
    if (this.#client) {
      const result = await this.#client.decisions.create({
        model: this.#config.DECISION_MODEL,
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
    }

    const response = await fetch(this.#config.DECISION_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        "authorization": `Bearer ${this.#config.DECISION_API_KEY}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(this.#config.AI_TIMEOUT_MS),
      body: JSON.stringify({
        model: this.#config.DECISION_MODEL,
        state: input,
        questions: { action: { type: "choice", instructions, criteria } },
      }),
    });

    if (!response.ok) {
      throw new Error(`决策服务请求失败（HTTP ${response.status}）`);
    }

    const raw: unknown = await response.json();
    // Clef returns the decision data inside the Workers AI 'result' field.
    const body =
      this.#config.DECISION_PROVIDER === "clef"
        ? z.object({ success: z.literal(true), result: z.unknown() }).parse(raw)
            .result
        : raw;
    const result = z
      .object({
        answers: z.record(z.string(), z.unknown()),
      })
      .parse(body);

    return result.answers.action;
  }
}
