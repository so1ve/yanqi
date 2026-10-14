import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Note } from "../types.ts";
import { StoreError, required } from "./errors.ts";
import { readDataFile, topicDirectory, writeMarkdown } from "./files.ts";
import type { Database, NoteRow } from "./schema.ts";

export const decodeNote = (row: NoteRow): Note & { createdAt: number } => ({
  ...row,
  sections: JSON.parse(row.sections),
});

export class SavedNotes {
  #db: Database;
  #directory: string;

  constructor(db: Database, directory: string) {
    this.#db = db;
    this.#directory = directory;
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
      .select(["id", "revision", "createdAt", "sourceThrough"])
      .where("topicId", "=", topicId)
      .orderBy("revision", "desc")
      .execute();
  }

  #findQuery(topicId: string, revision?: number) {
    let query = this.#db.selectFrom("notes").where("topicId", "=", topicId);

    if (revision !== undefined) {
      query = query.where("revision", "=", revision);
    }

    return query.orderBy("revision", "desc").limit(1);
  }

  public metadata(topicId: string, revision?: number) {
    return this.#findQuery(topicId, revision)
      .select(["id", "revision"])
      .select((eb) => eb.fn<number>("length", ["markdown"]).as("textChars"))
      .executeTakeFirst();
  }

  public async find(topicId: string, revision?: number): Promise<Note | null> {
    const note = await this.#findQuery(topicId, revision)
      .selectAll()
      .executeTakeFirst();

    return note ? decodeNote(note) : null;
  }

  public async version(groupId: string, topicId: string, id?: number) {
    let query = this.#db
      .selectFrom("notes")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("topicId", "=", topicId);

    if (id !== undefined) {
      query = query.where("id", "=", id);
    }

    const row = await query
      .orderBy("revision", "desc")
      .limit(1)
      .executeTakeFirst();

    return row ? decodeNote(row) : undefined;
  }

  public async sourceMessageIds(note: Note): Promise<number[]> {
    let sections = note.sections;

    // 手工编辑只改正文，原文沿用此前最近一次整理的版本。
    if (sections.length === 0) {
      const earlier = await this.#db
        .selectFrom("notes")
        .select("sections")
        .where("topicId", "=", note.topicId)
        .where("revision", "<", note.revision)
        .orderBy("revision", "desc")
        .execute();

      sections =
        earlier
          .map((row): Note["sections"] => JSON.parse(row.sections))
          .find((items) => items.length > 0) ?? [];
    }

    const ids = [...new Set(sections.flatMap((section) => section.messageIds))];

    if (ids.length === 0) {
      return [];
    }

    const messages = await this.#db
      .selectFrom("messages")
      .select("id")
      .where("groupId", "=", note.groupId)
      .where("id", "in", ids)
      .orderBy("sentAt")
      .orderBy("id")
      .execute();

    return messages.map((message) => message.id);
  }

  public edit(
    groupId: string,
    topicId: string,
    input: { noteId: number; markdown: string },
  ) {
    return this.#db.transaction().execute(async (db) => {
      const topic = required(
        await db
          .selectFrom("topics")
          .selectAll()
          .where("id", "=", topicId)
          .where("groupId", "=", groupId)
          .executeTakeFirst(),
      );

      if (topic.mode === "auto") {
        throw new StoreError("conflict", "讨论草稿需先生成纪要，再编辑正文");
      }

      const current = required(
        await db
          .selectFrom("notes")
          .selectAll()
          .where("id", "=", input.noteId)
          .where("topicId", "=", topicId)
          .executeTakeFirst(),
      );
      const busy = await db
        .selectFrom("jobs")
        .select("id")
        .where("kind", "=", "summarize")
        .where("state", "in", ["pending", "running"])
        .where((eb) =>
          eb(
            eb.fn<string>("json_extract", ["payload", eb.val("$.topicId")]),
            "=",
            topicId,
          ),
        )
        .executeTakeFirst();

      if (
        busy !== undefined ||
        current.generation !== topic.generation ||
        current.revision !== topic.revision
      ) {
        throw new StoreError("conflict", "请等当前整理完成后，编辑最新版本");
      }

      const revision = topic.revision + 1;
      const generation = topic.generation + 1;
      const directory = join(
        topicDirectory(this.#directory, topic),
        `v${revision}`,
      );
      const markdown = input.markdown.replace(
        /^第 \d+ 版 ·/m,
        `第 ${revision} 版 ·`,
      );
      const path = join(directory, "note.md");
      const transcript = await readDataFile(
        this.#directory,
        join(dirname(current.path), "transcript.md"),
      );

      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "transcript.md"), transcript, {
        mode: 0o600,
      });
      await writeMarkdown(path, markdown);
      const note = await db
        .insertInto("notes")
        .values({
          topicId,
          groupId,
          sourceThrough: current.sourceThrough,
          revision,
          generation,
          markdown,
          path,
          sections: "[]",
          createdAt: Date.now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db
        .updateTable("topics")
        .set({ revision, generation, noteGeneration: generation })
        .where("id", "=", topicId)
        .execute();

      return decodeNote(note);
    });
  }
}
