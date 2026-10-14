import type { Static } from "typebox";
import { Type } from "typebox";
import * as Value from "typebox/value";

import { defaultPersona } from "./agent/prompts/persona.ts";

const positive = (fallback: number) =>
  Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    default: fallback,
  });
const qq = Type.String({ pattern: "^\\d+$" });
const modelSchema = Type.Object(
  {
    baseURL: Type.String({ default: "" }),
    apiKey: Type.String({ default: "" }),
    model: Type.String({ default: "" }),
  },
  { default: {}, additionalProperties: false },
);
const optionalModel = Type.Union([modelSchema, Type.Null()], { default: null });

export const configSchema = Type.Object(
  {
    BOT_QQ: Type.String({ pattern: "^\\d*$", default: "" }),
    GROUP_IDS: Type.Array(qq, { default: [] }),
    ADMIN_IDS: Type.Array(qq, { default: [] }),
    GROUP_ADMINS: Type.Record(qq, Type.Array(qq), { default: {} }),
    ONEBOT_URL: Type.String({ default: "ws://napcat:3001" }),
    ONEBOT_TOKEN: Type.String({ default: "" }),
    LOG_LEVEL: Type.Enum(["info", "debug"], { default: "info" }),
    LOG_DETAIL_CHARS: positive(4000),
    BOT_PERSONA: Type.String({ default: defaultPersona }),
    AI_MODEL: modelSchema,
    AI_CONTEXT_TOKENS: positive(272_000),
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
    AI_THINKING_TIMEOUT_MS: positive(300_000),
    AI_THINKING_MAX_OUTPUT_TOKENS: positive(32_768),
    AI_INPUT_CHARS: Type.Integer({
      minimum: 4000,
      maximum: Number.MAX_SAFE_INTEGER,
      default: 24_000,
    }),
    AI_DAILY_CALL_LIMIT: positive(2000),
    DETECT_INTERVAL_MS: positive(30_000),
    AUTO_REPLY: Type.Boolean({ default: true }),
    DETECT_BATCH_SIZE: positive(20),
    TOPIC_IDLE_MS: positive(600_000),
    TOPIC_REOPEN_MS: positive(86_400_000),
    WORK_INTERVAL_MS: positive(1000),
    MAX_ATTACHMENT_BYTES: positive(52_428_800),
    HISTORY_RETENTION_DAYS: Type.Integer({
      minimum: 0,
      maximum: 36_500,
      default: 30,
    }),
    AI_VISION_MODEL: optionalModel,
    AI_AUDIO_MODEL: optionalModel,
  },
  { additionalProperties: false },
);

function readURL(value: string, protocols: string[], field: string): string {
  if (!URL.canParse(value) || !protocols.includes(new URL(value).protocol)) {
    throw new Error(
      `配置错误：${field} 需要有效的 ${protocols.join(" / ")} 地址`,
    );
  }

  return value;
}

export type ModelConfig = Static<typeof modelSchema>;
export type Config = Static<typeof configSchema>;

export function contextInputBudget(config: Config): number {
  // SDK 还会预留 4,096 token；会话需提前给完整输出额度留出空间。
  return (
    config.AI_CONTEXT_TOKENS -
    Math.max(
      config.AI_MAX_OUTPUT_TOKENS,
      config.AI_THINKING_MAX_OUTPUT_TOKENS,
    ) -
    4096
  );
}

export function parseConfig(input: unknown): Config {
  const config = Value.Default(configSchema, structuredClone(input));

  if (!Value.Check(configSchema, config)) {
    throw new Error(
      `配置错误：${Value.Errors(configSchema, config)
        .map((error) => `${error.instancePath} ${error.message}`)
        .join("；")}`,
    );
  }

  if (contextInputBudget(config) <= 0) {
    throw new Error(
      "配置错误：主模型上下文窗口须大于普通和思考请求的输出上限，并额外留出 4,096 token 输入余量",
    );
  }

  readURL(config.ONEBOT_URL, ["ws:", "wss:"], "ONEBOT_URL");
  for (const key of [
    "AI_MODEL",
    "AI_VISION_MODEL",
    "AI_AUDIO_MODEL",
  ] as const) {
    if (config[key]?.baseURL) {
      readURL(config[key].baseURL, ["http:", "https:"], key);
    }
  }

  if (config.DECISION_URL) {
    readURL(config.DECISION_URL, ["http:", "https:"], "DECISION_URL");
  }

  return config;
}

export function configurationError(config: Config): string | undefined {
  if (!config.BOT_QQ || !config.ONEBOT_TOKEN) {
    return "请先在设置中填写机器人 QQ 号和 OneBot Token";
  }

  if (config.GROUP_IDS.length === 0) {
    return "请至少启用一个记录群";
  }

  if (
    !config.AI_MODEL.baseURL ||
    !config.AI_MODEL.apiKey ||
    !config.AI_MODEL.model
  ) {
    return "请填写主模型的服务地址、API Key 和模型名称";
  }

  for (const key of ["AI_VISION_MODEL", "AI_AUDIO_MODEL"] as const) {
    const model = config[key];

    if (model && (!model.baseURL || !model.apiKey || !model.model)) {
      return `请填写${key === "AI_VISION_MODEL" ? "视觉" : "语音"}模型的服务地址、API Key 和模型名称`;
    }
  }

  if (
    config.DECISION_PROVIDER !== "llm" &&
    (!config.DECISION_URL || !config.DECISION_API_KEY || !config.DECISION_MODEL)
  ) {
    return "请填写请求识别服务的地址、API Key 和模型名称";
  }
}
