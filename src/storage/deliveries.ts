import type { Delivery } from "../types.ts";
import type { Database } from "./schema.ts";

export class DeliveryQueue {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async enqueue(
    key: string,
    groupId: string,
    topicId: string | null,
    noteId: number | null,
    kind: Delivery["kind"],
    content: string,
  ): Promise<void> {
    await this.#db.transact(async (db) => {
      const [existing] = await db.get("deliveries", { key });

      if (!existing) {
        await db.create("deliveries", {
          key,
          groupId,
          topicId,
          noteId,
          kind,
          content,
          createdAt: Date.now(),
        });
      }
    });
  }

  public async next(): Promise<Delivery | null> {
    return this.#db.transact(async (db) => {
      const intents = await db.get("jobs", {
        kind: "intent",
        $or: [{ state: "pending" }, { state: "running" }],
      }, ["payload"]);
      const blockedGroups = [
        ...new Set(intents.map((job) => job.payload.groupId)),
      ];
      const [delivery] = await db.get(
        "deliveries",
        {
          state: "pending",
          $or: [{ kind: "text" }, { groupId: { $nin: blockedGroups } }],
        },
        { sort: { id: "asc" }, limit: 1 },
      );

      return delivery ?? null;
    });
  }

  public async done(id: number): Promise<void> {
    await this.#db.transact((db) =>
      db.set("deliveries", { id }, { state: "done" }),
    );
  }
}
