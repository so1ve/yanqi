import assert from "node:assert/strict";

import { $ } from "koishi";

import type { Database } from "./schema.ts";

export class Groups {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async setAutomatic(groupId: string, enabled: boolean): Promise<void> {
    await this.#db.transact((db) =>
      db.set("groups", { id: groupId }, { aiEnabled: enabled }),
    );
  }

  public async automatic(groupId: string): Promise<boolean> {
    const [group] = await this.#db.get("groups", { id: groupId });

    assert.ok(group);

    return group.aiEnabled;
  }

  public async statistics(groupId: string) {
    const messages = await this.#db.eval("messages", (row) => $.count(row.id), {
      groupId,
      isBot: false,
    });
    const notes = await this.#db.eval("notes", (row) => $.count(row.id), {
      groupId,
    });
    const documents = await this.#db.eval("topics", (row) => $.count(row.id), {
      groupId,
      revision: { $gt: 0 },
    });
    const failed = await this.#db.eval("jobs", (row) => $.count(row.id), {
      "$not": { $or: [{ kind: "intent" }, { kind: "observe" }] },
      "state": "failed",
      "payload.groupId": groupId,
    });
    const pending = await this.#db.eval("jobs", (row) => $.count(row.id), {
      "$or": [{ state: "pending" }, { state: "running" }],
      "payload.groupId": groupId,
    });
    const failedDeliveries = await this.#db.eval(
      "deliveries",
      (row) => $.count(row.id),
      {
        groupId,
        state: "failed",
      },
    );
    const pendingDeliveries = await this.#db.eval(
      "deliveries",
      (row) => $.count(row.id),
      {
        groupId,
        state: "pending",
      },
    );

    return {
      messages,
      documents,
      versions: notes,
      automatic: await this.automatic(groupId),
      pendingTasks: pending,
      failedTasks: failed,
      pendingDeliveries,
      failedDeliveries,
    };
  }
}
