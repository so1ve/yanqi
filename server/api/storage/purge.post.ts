import { defineEventHandler } from "h3";

export default defineEventHandler((event) => event.context.bot.purge());
