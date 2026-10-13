import { defineEventHandler, getRouterParam } from "h3";

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

  return store.notes.sourceMessageIds(note);
});
