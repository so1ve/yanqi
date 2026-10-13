import { dirname, join } from "node:path";

import { defineEventHandler, getRouterParam, setResponseHeader } from "h3";

import { readDataFile } from "~~/server/files";
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
    await db
      .selectFrom("topics")
      .selectAll()
      .where("id", "=", getRouterParam(event, "topicId")!)
      .where("groupId", "=", groupId)
      .executeTakeFirst(),
  );
  const note = queryParam(event, "version")
    ? requireItem(
        await db
          .selectFrom("notes")
          .select("path")
          .where("id", "=", integer(queryParam(event, "version")))
          .where("topicId", "=", topic.id)
          .executeTakeFirst(),
      )
    : requireItem((await bot.store.notes.find(topic.id)) ?? undefined);
  const path = join(dirname(note.path), "transcript.md");

  setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");

  return (await readDataFile(bot.store.directory, path)).toString("utf8");
});
