import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
} from "h3";

import {
  groupParam,
  integer,
  queryParam,
  requireItem,
} from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const db = bot.database;
  const groupId = groupParam(event);

  const topic = requireItem(
    (
      await db.get("topics", {
        id: getRouterParam(event, "topicId")!,
        groupId,
      })
    )[0],
  );
  const note = queryParam(event, "version")
    ? requireItem(
        (
          await db.get("notes", {
            id: integer(queryParam(event, "version")),
            topicId: topic.id,
          })
        )[0],
      )
    : requireItem((await bot.store.notes.latest(topic.id)) ?? undefined);
  const path = resolve(dirname(note.path), "transcript.md");

  if (!path.startsWith(`${resolve(bot.store.directory)}${sep}`)) {
    throw createError({ statusCode: 400, message: "原文不在当前数据目录中" });
  }

  setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");

  return await readFile(path, "utf8");
});
