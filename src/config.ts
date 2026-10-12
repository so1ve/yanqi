import { Type } from "typebox";
import * as Value from "typebox/value";

const positive = (fallback: number) =>
  Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    default: fallback,
  });
const qq = Type.String({ pattern: "^\\d+$" });
const optionalModel = Type.Optional(Type.String());

const schema = Type.Object({
  BOT_QQ: qq,
  GROUP_IDS: Type.Array(qq, { minItems: 1 }),
  ADMIN_IDS: Type.Array(qq, { default: [] }),
  ONEBOT_URL: Type.String({ default: "ws://127.0.0.1:3001" }),
  ONEBOT_TOKEN: Type.String({ minLength: 1 }),
  ACK_EMOJI_ID: Type.String({ pattern: "^\\d*$", default: "128051" }),
  DATA_DIR: Type.String({ minLength: 1, default: "./data" }),
  LOG_LEVEL: Type.Enum(["info", "debug"], { default: "info" }),
  LOG_DETAIL_CHARS: positive(4000),
  BOT_PERSONA_FILE: Type.String({ default: "./PERSONA.md" }),
  AI_MODEL: Type.String({ minLength: 1 }),
  DECISION_PROVIDER: Type.Enum(["llm", "openai", "vercel", "jev", "clef"], {
    default: "llm",
  }),
  DECISION_URL: Type.String({ default: "" }),
  DECISION_API_KEY: Type.String({ default: "" }),
  DECISION_MODEL: Type.String({ default: "" }),
  AI_RESPONSE_FORMAT: Type.Enum(["json_schema", "json_object"], {
    default: "json_object",
  }),
  AI_TIMEOUT_MS: positive(120_000),
  AI_MAX_OUTPUT_TOKENS: positive(8192),
  AI_INPUT_CHARS: Type.Integer({
    minimum: 4000,
    maximum: Number.MAX_SAFE_INTEGER,
    default: 24_000,
  }),
  AI_DAILY_CALL_LIMIT: positive(2000),
  DETECT_INTERVAL_MS: positive(30_000),
  AUTO_REPLY: Type.Enum(["true", "false"], { default: "true" }),
  DETECT_BATCH_SIZE: positive(20),
  TOPIC_IDLE_MS: positive(600_000),
  TOPIC_REOPEN_MS: positive(86_400_000),
  WORK_INTERVAL_MS: positive(1000),
  MAX_ATTACHMENT_BYTES: positive(52_428_800),
  AI_VISION_MODEL: optionalModel,
  AI_AUDIO_MODEL: optionalModel,
});

const modelParameters = Type.Tuple([
  Type.String(),
  Type.String({ minLength: 1 }),
  Type.String({ minLength: 1 }),
]);

function readURL(value: string, protocols: string[], field: string): string {
  if (!URL.canParse(value) || !protocols.includes(new URL(value).protocol)) {
    throw new Error(
      `配置错误：${field} 需要有效的 ${protocols.join(" / ")} 地址`,
    );
  }

  return value;
}

function readModel(value: string, field: string) {
  const parts = value.split(",");

  parts[2] = parts[2]?.trim() ?? "";

  if (!Value.Check(modelParameters, parts)) {
    throw new Error(`配置错误：${field} 需要填写 BASE_URL,API_KEY,MODEL`);
  }

  const [baseURL, apiKey, model] = parts;

  return {
    baseURL: readURL(baseURL, ["http:", "https:"], field),
    apiKey,
    model,
  };
}

const readOptionalModel = (value: string | undefined, field: string) =>
  value ? readModel(value, field) : undefined;

export type ModelConfig = ReturnType<typeof readModel>;
export type Config = ReturnType<typeof readConfig>;

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const input: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(schema.properties)) {
    const value = env[key];

    input[key] =
      value !== undefined && (Type.IsNumber(field) || Type.IsInteger(field))
        ? Number(value)
        : value;
  }

  for (const key of ["GROUP_IDS", "ADMIN_IDS"]) {
    input[key] = env[key]
      ?.split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  const config = Value.Default(schema, input);

  if (!Value.Check(schema, config)) {
    throw new Error(
      `配置错误：${Value.Errors(schema, config)
        .map((error) => `${error.instancePath} ${error.message}`)
        .join("；")}`,
    );
  }

  if (
    config.DECISION_PROVIDER !== "llm" &&
    (!config.DECISION_URL ||
      !config.DECISION_API_KEY ||
      !config.DECISION_MODEL.trim())
  ) {
    throw new Error(
      "启用独立决策服务时，需要填写 DECISION_URL、DECISION_API_KEY、DECISION_MODEL",
    );
  }

  return {
    ...config,
    ONEBOT_URL: readURL(config.ONEBOT_URL, ["ws:", "wss:"], "ONEBOT_URL"),
    BOT_PERSONA_FILE: config.BOT_PERSONA_FILE.trim(),
    DECISION_MODEL: config.DECISION_MODEL.trim(),
    AUTO_REPLY: config.AUTO_REPLY === "true",
    AI_MODEL: readModel(config.AI_MODEL, "AI_MODEL"),
    AI_VISION_MODEL: readOptionalModel(
      config.AI_VISION_MODEL,
      "AI_VISION_MODEL",
    ),
    AI_AUDIO_MODEL: readOptionalModel(config.AI_AUDIO_MODEL, "AI_AUDIO_MODEL"),
  };
}
