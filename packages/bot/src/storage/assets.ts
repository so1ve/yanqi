import assert from "node:assert/strict";

import type { Asset } from "../types.ts";
import type { Database } from "./schema.ts";
import { messageChanged } from "./topic-sources.ts";

export class Assets {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async get(id: number): Promise<Asset> {
    const asset = await this.#db
      .selectFrom("assets")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    if (!asset) {
      throw new Error(`不存在的附件 ${id}`);
    }

    return asset;
  }

  public forMessage(messageId: number): Promise<Asset[]> {
    return this.#db
      .selectFrom("assets")
      .selectAll()
      .where("messageId", "=", messageId)
      .orderBy("id")
      .execute();
  }

  public async save(
    id: number,
    state: Asset["state"],
    path: string | null,
    interpretation: string | null,
    error: string | null,
  ): Promise<void> {
    await this.#db.transaction().execute(async (db) => {
      const asset = await db
        .selectFrom("assets")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      assert.ok(asset);
      if (
        asset.state === state &&
        asset.path === path &&
        asset.interpretation === interpretation &&
        asset.error === error
      ) {
        return;
      }

      await db
        .updateTable("assets")
        .set({ state, path, interpretation, error })
        .where("id", "=", id)
        .execute();
      await messageChanged(db, asset.messageId);
    });
  }
}
