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
    const [asset] = await this.#db.get("assets", { id });

    if (!asset) {
      throw new Error(`不存在的附件 ${id}`);
    }

    return asset;
  }

  public forMessage(messageId: number): Promise<Asset[]> {
    return this.#db.get("assets", { messageId }, { sort: { id: "asc" } });
  }

  public async save(
    id: number,
    state: Asset["state"],
    path: string | null,
    interpretation: string | null,
    error: string | null,
  ): Promise<void> {
    await this.#db.transact(async (db) => {
      const [asset] = await db.get("assets", { id });

      assert.ok(asset);
      if (
        asset.state === state &&
        asset.path === path &&
        asset.interpretation === interpretation &&
        asset.error === error
      ) {
        return;
      }

      await db.set("assets", { id }, { state, path, interpretation, error });
      await messageChanged(db, asset.messageId);
    });
  }
}
