import type { Config } from "@yanqi/bot";

export const modelKeys = [
  "AI_MODEL",
  "AI_VISION_MODEL",
  "AI_AUDIO_MODEL",
] as const;
export const secretKeys = ["ONEBOT_TOKEN", "DECISION_API_KEY"] as const;

export function maskedConfig(config: Config) {
  const masked = structuredClone(config);
  const secrets: Record<string, boolean> = {};

  for (const key of secretKeys) {
    secrets[key] = Boolean(masked[key]);
    masked[key] = "";
  }

  for (const key of modelKeys) {
    const model = masked[key];

    secrets[key] = Boolean(model?.apiKey);
    if (model) {
      model.apiKey = "";
    }
  }

  return { config: masked, secrets };
}
