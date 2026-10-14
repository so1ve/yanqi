import { decodeJob } from "./jobs.ts";
import type { Database } from "./schema.ts";
import { summaryTaskState } from "./topics.ts";

export async function overview(db: Database, day: string) {
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
        .select(summaryTaskState)
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
  };
}
