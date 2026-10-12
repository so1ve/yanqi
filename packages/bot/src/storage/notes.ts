import assert from "node:assert/strict";

import type { Note } from "../types.ts";
import type { Database } from "./schema.ts";

export class SavedNotes {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public save(
    topicId: string,
    sourceThrough: number,
    generation: number,
    markdown: string,
    sections: Note["sections"],
    path: string,
    now: number,
  ): Promise<Note> {
    return this.#db.transact(async (db) => {
      const [topic] = await db.get("topics", { id: topicId });

      assert.ok(topic);
      const revision = topic.revision + 1;
      const note = await db.create("notes", {
        topicId,
        groupId: topic.groupId,
        revision,
        sourceThrough,
        generation,
        markdown,
        sections,
        path,
        createdAt: now,
      });

      await db.set(
        "topics",
        { id: topicId },
        { revision, noteGeneration: generation },
      );

      return note;
    });
  }

  public async get(id: number): Promise<Note> {
    const [note] = await this.#db.get("notes", { id });

    if (!note) {
      throw new Error(`不存在的纪要 ${id}`);
    }

    return note;
  }

  public async latest(topicId: string): Promise<Note | null> {
    const [note] = await this.#db.get(
      "notes",
      { topicId },
      { sort: { revision: "desc" }, limit: 1 },
    );

    return note ?? null;
  }
}
