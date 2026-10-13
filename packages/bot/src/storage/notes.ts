import assert from "node:assert/strict";

import type { Note } from "../types.ts";
import type { Database, NoteRow } from "./schema.ts";

export const decodeNote = (row: NoteRow): Note & { createdAt: number } => ({
  ...row,
  sections: JSON.parse(row.sections),
});

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
    return this.#db.transaction().execute(async (db) => {
      const topic = await db
        .selectFrom("topics")
        .selectAll()
        .where("id", "=", topicId)
        .executeTakeFirst();

      assert.ok(topic);
      const revision = topic.revision + 1;
      const note = await db
        .insertInto("notes")
        .values({
          topicId,
          groupId: topic.groupId,
          revision,
          sourceThrough,
          generation,
          markdown,
          sections: JSON.stringify(sections),
          path,
          createdAt: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db
        .updateTable("topics")
        .set({ revision, noteGeneration: generation })
        .where("id", "=", topicId)
        .execute();

      return decodeNote(note);
    });
  }

  public async get(id: number): Promise<Note> {
    const note = await this.#db
      .selectFrom("notes")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    if (!note) {
      throw new Error(`不存在的纪要 ${id}`);
    }

    return decodeNote(note);
  }

  public versions(topicId: string) {
    return this.#db
      .selectFrom("notes")
      .select(["revision", "createdAt"])
      .where("topicId", "=", topicId)
      .orderBy("revision", "desc")
      .execute();
  }

  public async find(topicId: string, revision?: number): Promise<Note | null> {
    let query = this.#db
      .selectFrom("notes")
      .selectAll()
      .where("topicId", "=", topicId);

    if (revision !== undefined) {
      query = query.where("revision", "=", revision);
    }

    const note = await query
      .orderBy("revision", "desc")
      .limit(1)
      .executeTakeFirst();

    return note ? decodeNote(note) : null;
  }
}
