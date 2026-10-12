import { Type } from "typebox";
import * as Value from "typebox/value";

import type { Config } from "../../config.ts";
import { readJevAnswers, requestJev } from "./jev.ts";
import type { EvaluateDecision } from "./types.ts";

const responseSchema = Type.Object({
  success: Type.Literal(true),
  result: Type.Unknown(),
});

export const createClefDecision =
  (config: Config): EvaluateDecision =>
  async (request, signal) => {
    const body = await requestJev(config, request, signal);

    if (!Value.Check(responseSchema, body)) {
      throw new Error("Clef 未返回成功的决策结果");
    }

    // Clef 复用 JEV 协议，结果包在 Workers AI 的 result 字段里。
    return readJevAnswers(body.result);
  };
