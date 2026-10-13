import { $ } from "@koishijs/core";
import { defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;

  const db = bot.database;
  const day = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
  }).format(Date.now());
  const [messages, records, pending, failed, calls, recent, tasks] =
    await Promise.all([
      db.eval("messages", (row) => $.count(row.id), { isBot: false }),
      db.eval("topics", (row) => $.count(row.id), { revision: { $gt: 0 } }),
      db.eval("jobs", (row) => $.count(row.id), {
        $or: [{ state: "pending" }, { state: "running" }],
      }),
      db.eval("jobs", (row) => $.count(row.id), {
        state: "failed",
        $not: { $or: [{ kind: "intent" }, { kind: "observe" }] },
      }),
      db.eval("usage", (row) => $.count(row.id), { day }),
      db.get("topics", {}, { sort: { lastActiveAt: "desc" }, limit: 6 }),
      db.get(
        "jobs",
        { $or: [{ state: "pending" }, { state: "running" }] },
        { sort: { id: "desc" }, limit: 6 },
      ),
    ]);

  return {
    messages,
    records,
    pending,
    failed,
    calls,
    recent,
    tasks,
    day,
    dailyLimit: bot.config.AI_DAILY_CALL_LIMIT,
  };
});
