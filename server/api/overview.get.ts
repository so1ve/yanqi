import { decodeJob } from "@yanqi/bot";
import { defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const db = bot.database;
  const day = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
  }).format(Date.now());
  const [messages, records, pending, failed, calls, recent, tasks] =
    await Promise.all([
      db
        .selectFrom("messages")
        .where("isBot", "=", 0)
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("topics")
        .where("revision", ">", 0)
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("jobs")
        .where("state", "in", ["pending", "running"])
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("jobs")
        .where("state", "=", "failed")
        .where("kind", "not in", ["intent", "observe"])
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("usage")
        .where("day", "=", day)
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("topics")
        .selectAll()
        .orderBy("lastActiveAt", "desc")
        .limit(6)
        .execute(),
      db
        .selectFrom("jobs")
        .selectAll()
        .where("state", "in", ["pending", "running"])
        .orderBy("id", "desc")
        .limit(6)
        .execute(),
    ]);

  return {
    messages: messages.count,
    records: records.count,
    pending: pending.count,
    failed: failed.count,
    calls: calls.count,
    recent,
    tasks: tasks.map(decodeJob),
    day,
    dailyLimit: bot.config.AI_DAILY_CALL_LIMIT,
  };
});
