import { defineEventHandler } from "h3";

export default defineEventHandler((event) => {
  const { bot } = event.context;

  return {
    running: bot.running,
    connected: bot.online,
    groups: bot.config.GROUP_IDS,
    model: bot.config.AI_MODEL.model,
    decision: bot.config.DECISION_PROVIDER,
  };
});
