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
  const { store } = event.context.bot;
  const version = queryParam(event, "version");
  const note = requireItem(
    await store.notes.version(
      groupParam(event),
      getRouterParam(event, "topicId")!,
      version ? integer(version) : undefined,
    ),
  );

  setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");

  return (
    await readDataFile(
      store.directory,
      join(dirname(note.path), "transcript.md"),
    )
  ).toString("utf8");
});
