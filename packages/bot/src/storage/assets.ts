import assert from "node:assert/strict";

import type { Asset } from "../types.ts";
import {
  assetPath,
  interpretationPath,
  readInterpretation,
} from "./asset-files.ts";
import { writeMarkdown } from "./files.ts";
import type { Database } from "./schema.ts";
import { messageChanged } from "./topic-sources.ts";

export class Assets {
  #db: Database;
  #directory: string;
  #interpreting = new Map<string, Promise<string>>();

  constructor(db: Database, directory: string) {
    this.#db = db;
    this.#directory = directory;
  }

  public async file(groupId: string, name: string): Promise<Asset | undefined> {
    return this.#db
      .selectFrom("assets")
      .innerJoin("messages", "messages.id", "assets.messageId")
      .selectAll("assets")
      .where("messages.groupId", "=", groupId)
      .where("assets.path", "=", assetPath(this.#directory, name))
      .limit(1)
      .executeTakeFirst();
  }

  public interpret(
    path: string,
    produce: () => Promise<string>,
  ): Promise<string> {
    const key = interpretationPath(path);
    const running = this.#interpreting.get(key);

    if (running) {
      return running;
    }

    const result = (async () => {
      const cached = await readInterpretation(path);

      if (cached !== null) {
        return cached;
      }

      const content = await produce();

      await writeMarkdown(key, content);

      return content;
    })().finally(() => this.#interpreting.delete(key));

    this.#interpreting.set(key, result);

    return result;
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

  public async images(messageIds: number[]): Promise<Asset[]> {
    if (messageIds.length === 0) {
      return [];
    }

    return this.#db
      .selectFrom("assets")
      .selectAll()
      .where("messageId", "in", messageIds)
      .where("kind", "=", "image")
      .where("path", "is not", null)
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
