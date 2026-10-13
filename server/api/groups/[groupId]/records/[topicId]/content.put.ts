import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { createError, defineEventHandler, getRouterParam } from "h3";
import { Type } from "typebox";

import { body, groupParam, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const db = bot.database;
  const groupId = groupParam(event);

  const input = await body(
    event,
    Type.Object({
      noteId: Type.Integer({ minimum: 1 }),
      markdown: Type.String({ minLength: 1, maxLength: 2_000_000 }),
    }),
  );
  const note = await db.transact(async (tx) => {
    const topic = requireItem(
      (
        await tx.get("topics", {
          id: getRouterParam(event, "topicId")!,
          groupId,
        })
      )[0],
    );
    const current = requireItem(
      (await tx.get("notes", { id: input.noteId, topicId: topic.id }))[0],
    );
    const busy = await tx.get("jobs", {
      "kind": "summarize",
      "payload.topicId": topic.id,
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
      bot.config.DATA_DIR,
      "groups",
      topic.groupId,
      "topics",
      topic.id,
      `v${revision}`,
    );

    await mkdir(directory, { recursive: true });
    const markdown = input.markdown.replace(
      /^第 \d+ 版 ·/m,
      `第 ${revision} 版 ·`,
    );
    const path = join(directory, "note.md");
    const temporary = `${path}.${randomUUID()}.part`;
    const source = resolve(dirname(current.path), "transcript.md");

    if (!source.startsWith(`${resolve(bot.config.DATA_DIR)}${sep}`)) {
      throw createError({ statusCode: 400, message: "原文不在当前数据目录中" });
    }

    await writeFile(join(directory, "transcript.md"), await readFile(source), {
      mode: 0o600,
    });
    await writeFile(temporary, markdown, { mode: 0o600 });
    await rename(temporary, path);
    const note = await tx.create("notes", {
      topicId: topic.id,
      groupId: topic.groupId,
      sourceThrough: current.sourceThrough,
      revision,
      generation,
      markdown,
      path,
      sections: [],
      createdAt: Date.now(),
    });

    await tx.set(
      "topics",
      { id: topic.id },
      { revision, generation, noteGeneration: generation },
    );

    return note;
  });

  return note;
});
