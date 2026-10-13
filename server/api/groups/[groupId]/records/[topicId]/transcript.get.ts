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
  const path = join(dirname(note.path), "transcript.md");

  setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");

  return (await readDataFile(bot.store.directory, path)).toString("utf8");
});
