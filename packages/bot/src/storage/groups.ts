import assert from "node:assert/strict";

import type { Database } from "./schema.ts";

export class Groups {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public list() {
    return this.#db.selectFrom("groups").selectAll().execute();
  }

  public find(id: string) {
    return this.#db
      .selectFrom("groups")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  public async ensure(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.#db
      .insertInto("groups")
      .values(ids.map((id) => ({ id })))
      .onConflict((conflict) => conflict.column("id").doNothing())
      .execute();
  }

  public async advanceHistory(groupId: string, through: number): Promise<void> {
    await this.#db
      .updateTable("groups")
      .set({ historyThrough: through })
      .where("id", "=", groupId)
      .where("historyThrough", "<", through)
      .execute();
  }

  public async configure(id: string, automatic?: boolean): Promise<void> {
    await this.#db
      .insertInto("groups")
      .values({
        id,
        ...(automatic === undefined ? {} : { aiEnabled: Number(automatic) }),
      })
      .onConflict((conflict) =>
        automatic === undefined
          ? conflict.column("id").doNothing()
          : conflict.column("id").doUpdateSet({ aiEnabled: Number(automatic) }),
      )
      .execute();
  }

  public async setAutomatic(groupId: string, enabled: boolean): Promise<void> {
    await this.#db
      .updateTable("groups")
      .set({ aiEnabled: Number(enabled) })
      .where("id", "=", groupId)
      .execute();
  }

  public async automatic(groupId: string): Promise<boolean> {
    const group = await this.#db
      .selectFrom("groups")
      .select("aiEnabled")
      .where("id", "=", groupId)
      .executeTakeFirst();

    assert.ok(group);

    return Boolean(group.aiEnabled);
  }

  public async statistics(groupId: string) {
    const db = this.#db;
    const jobs = db
      .selectFrom("jobs")
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
          "=",
          groupId,
        ),
      );
    const deliveries = db
      .selectFrom("deliveries")
      .where("groupId", "=", groupId);
    const [
      messages,
      notes,
      documents,
      failed,
      pending,
      failedDeliveries,
      pendingDeliveries,
    ] = await Promise.all([
      db
        .selectFrom("messages")
        .where("groupId", "=", groupId)
        .where("isBot", "=", 0)
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("notes")
        .innerJoin("topics", "topics.id", "notes.topicId")
        .where("topics.mode", "=", "manual")
        .where("notes.groupId", "=", groupId)
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("topics")
        .where("groupId", "=", groupId)
        .where("mode", "=", "manual")
        .where("revision", ">", 0)
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
      jobs
        .where("kind", "not in", ["intent", "observe"])
        .where("state", "=", "failed")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
      jobs
        .where("kind", "not in", ["intent", "observe"])
        .where("state", "in", ["pending", "running"])
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
      deliveries
        .where("state", "=", "failed")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
      deliveries
        .where("state", "=", "pending")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
    ]);

    return {
      messages: messages.count,
      documents: documents.count,
      versions: notes.count,
      automatic: await this.automatic(groupId),
      pendingTasks: pending.count,
      failedTasks: failed.count,
      pendingDeliveries: pendingDeliveries.count,
      failedDeliveries: failedDeliveries.count,
    };
  }
}
