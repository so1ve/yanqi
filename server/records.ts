import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Yanqi } from "@yanqi/bot";
import {
  decodeNote,
  enqueueJob,
  topicDirectory,
  writeMarkdown,
} from "@yanqi/bot";
import { createError } from "h3";

import { readDataFile } from "./files";
import { requireItem } from "./utils/http";

export const editNote = (
  bot: Yanqi,
  groupId: string,
  topicId: string,
  input: { noteId: number; markdown: string },
) =>
  bot.database.transaction().execute(async (db) => {
    const topic = requireItem(
      await db
        .selectFrom("topics")
        .selectAll()
        .where("id", "=", topicId)
        .where("groupId", "=", groupId)
        .executeTakeFirst(),
    );
    const current = requireItem(
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
      throw createError({
        statusCode: 409,
        message: "请等当前整理完成后，编辑最新版本",
      });
    }

    const revision = topic.revision + 1;
    const generation = topic.generation + 1;
    const directory = join(
      topicDirectory(bot.store.directory, topic),
      `v${revision}`,
    );
    const markdown = input.markdown.replace(
      /^第 \d+ 版 ·/m,
      `第 ${revision} 版 ·`,
    );
    const path = join(directory, "note.md");
    const transcript = await readDataFile(
      bot.store.directory,
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

export async function regenerateRecord(
  bot: Yanqi,
  groupId: string,
  topicId: string,
  focus: string,
) {
  if (!bot.config.GROUP_IDS.includes(groupId)) {
    throw createError({
      statusCode: 409,
      message: "请先在“群与成员”中启用该群的“保存消息”",
    });
  }

  const taskId = await bot.database.transaction().execute(async (db) => {
    const topic = requireItem(
      await db
        .selectFrom("topics")
        .selectAll()
        .where("id", "=", topicId)
        .where("groupId", "=", groupId)
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

    if (busy !== undefined) {
      throw createError({
        statusCode: 409,
        message: "这篇纪要正在排队或整理中",
      });
    }

    const generation = topic.generation + 1;

    await db
      .updateTable("topics")
      .set({ generation, focus })
      .where("id", "=", topicId)
      .execute();
    await db
      .updateTable("topic_messages")
      .set({ generation })
      .where("topicId", "=", topicId)
      .execute();

    return enqueueJob(db, "summarize", `summarize:${topicId}:${generation}`, {
      groupId,
      topicId,
      requested: true,
      publish: false,
    });
  });

  bot.wake();

  return { taskId };
}

export const deleteRecord = (
  bot: Yanqi,
  groupId: string,
  topicId: string,
): Promise<void> =>
  bot.database.transaction().execute(async (db) => {
    const topic = requireItem(
      await db
        .selectFrom("topics")
        .selectAll()
        .where("id", "=", topicId)
        .where("groupId", "=", groupId)
        .executeTakeFirst(),
    );
    const busy = await db
      .selectFrom("jobs")
      .select("id")
      .where("state", "=", "running")
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.topicId")]),
          "=",
          topicId,
        ),
      )
      .executeTakeFirst();

    if (busy !== undefined || bot.running) {
      throw createError({
        statusCode: 409,
        message: "请先暂停 AI，再删除纪要",
      });
    }

    await rm(topicDirectory(bot.store.directory, topic), {
      recursive: true,
      force: true,
    });
    await db.deleteFrom("deliveries").where("topicId", "=", topicId).execute();
    await db
      .deleteFrom("jobs")
      .where((eb) =>
        eb(
          eb.fn<string>("json_extract", ["payload", eb.val("$.topicId")]),
          "=",
          topicId,
        ),
      )
      .execute();
    await db.deleteFrom("notes").where("topicId", "=", topicId).execute();
    await db
      .deleteFrom("topic_messages")
      .where("topicId", "=", topicId)
      .execute();
    await db.deleteFrom("topics").where("id", "=", topicId).execute();
  });
