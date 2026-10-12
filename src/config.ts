import { z } from "zod";

const positive = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const model = z
  .string()
  .transform((value) => value.split(","))
  .pipe(
    z.tuple([
      z.url({ protocol: /^https?$/ }),
      z.string().min(1),
      z.string().trim().min(1),
    ]),
  )
  .transform(([baseURL, apiKey, model]) => ({ baseURL, apiKey, model }));

const optionalModel = z
  .union([z.literal("").transform(() => undefined), model])
  .optional();

export type ModelConfig = z.infer<typeof model>;

const schema = z.object({
  BOT_QQ: z.string().regex(/^\d+$/),
  GROUP_IDS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^\d+$/)).min(1)),
  ADMIN_IDS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^\d+$/))),
  ONEBOT_URL: z.url({ protocol: /^wss?$/ }).default("ws://127.0.0.1:3001"),
  ONEBOT_TOKEN: z.string().min(1),
  ACK_EMOJI_ID: z.string().regex(/^\d*$/).default("128064"),
  DATA_DIR: z.string().min(1).default("./data"),
  LOG_LEVEL: z.enum(["info", "debug"]).default("info"),
  LOG_DETAIL_CHARS: positive(4000),
  BOT_PERSONA_FILE: z.string().trim().default("./PERSONA.md"),
  AI_MODEL: model,
  AI_DETECT_MODEL: optionalModel,
  AI_INTENT_MODEL: optionalModel,
  AI_REPLY_MODEL: optionalModel,
  DECISION_PROVIDER: z
    .enum(["llm", "openai", "vercel", "jev", "clef"])
    .default("llm"),
  DECISION_URL: z.string().default(""),
  DECISION_API_KEY: z.string().default(""),
  DECISION_MODEL: z.string().trim().default(""),
  DECISION_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),
  AI_RESPONSE_FORMAT: z
    .enum(["json_schema", "json_object"])
    .default("json_object"),
  AI_TIMEOUT_MS: positive(120_000),
  AI_MAX_OUTPUT_TOKENS: positive(8192),
  AI_INPUT_CHARS: z.coerce.number().int().min(4000).default(24_000),
  AI_DAILY_CALL_LIMIT: positive(2000),
  DETECT_INTERVAL_MS: positive(30_000),
  AUTO_REPLY: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  DETECT_BATCH_SIZE: positive(20),
  TOPIC_IDLE_MS: positive(600_000),
  TOPIC_REOPEN_MS: positive(86_400_000),
  WORK_INTERVAL_MS: positive(1000),
  MAX_ATTACHMENT_BYTES: positive(52_428_800),
  AI_VISION_MODEL: optionalModel,
  AI_AUDIO_MODEL: optionalModel,
});

export type Config = z.infer<typeof schema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    throw new Error(
      `配置错误：${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("；")}`,
    );
  }

  if (
    parsed.data.DECISION_PROVIDER !== "llm" &&
    (!parsed.data.DECISION_URL ||
      !parsed.data.DECISION_API_KEY ||
      !parsed.data.DECISION_MODEL)
  ) {
    throw new Error(
      "启用独立决策服务时，需要填写 DECISION_URL、DECISION_API_KEY、DECISION_MODEL",
    );
  }

  return parsed.data;
}
