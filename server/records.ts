import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Yanqi } from "@yanqi/bot";
import { enqueueJob, topicDirectory, writeMarkdown } from "@yanqi/bot";
import { createError } from "h3";

import { readDataFile } from "./files";
import { requireItem } from "./utils/http";

export const editNote = (
  bot: Yanqi,
  groupId: string,
  topicId: string,
  input: { noteId: number; markdown: string },
) =>
  bot.database.transact(async (db) => {
    const topic = requireItem(
      (await db.get("topics", { id: topicId, groupId }))[0],
    );
    const current = requireItem(
      (await db.get("notes", { id: input.noteId, topicId }))[0],
    );
    const busy = await db.get("jobs", {
      "kind": "summarize",
      "payload.topicId": topicId,
      "$or": [{ state: "pending" }, { state: "running" }],
    });

    if (
      busy.length > 0 ||
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
    const note = await db.create("notes", {
      topicId,
      groupId,
      sourceThrough: current.sourceThrough,
      revision,
      generation,
      markdown,
      path,
      sections: [],
      createdAt: Date.now(),
    });

    await db.set(
      "topics",
      { id: topicId },
      { revision, generation, noteGeneration: generation },
    );

    return note;
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

  const taskId = await bot.database.transact(async (db) => {
    const topic = requireItem(
      (await db.get("topics", { id: topicId, groupId }))[0],
    );
    const busy = await db.get("jobs", {
      "kind": "summarize",
      "payload.topicId": topicId,
      "$or": [{ state: "pending" }, { state: "running" }],
    });

    if (busy.length > 0) {
      throw createError({
        statusCode: 409,
        message: "这篇纪要正在排队或整理中",
      });
    }

    const generation = topic.generation + 1;

    await db.set("topics", { id: topicId }, { generation, focus });
    await db.set("topic_messages", { topicId }, { generation });

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
  bot.database.transact(async (db) => {
    const topic = requireItem(
      (await db.get("topics", { id: topicId, groupId }))[0],
    );
    const busy = await db.get("jobs", {
      "payload.topicId": topicId,
      "state": "running",
    });

    if (busy.length > 0 || bot.running) {
      throw createError({
        statusCode: 409,
        message: "请先暂停 AI，再删除纪要",
      });
    }

    await rm(topicDirectory(bot.store.directory, topic), {
      recursive: true,
      force: true,
    });
    await db.remove("deliveries", { topicId });
    await db.remove("jobs", { "payload.topicId": topicId });
    await db.remove("notes", { topicId });
    await db.remove("topic_messages", { topicId });
    await db.remove("topics", { id: topicId });
  });
