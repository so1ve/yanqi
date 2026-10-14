import { defineEventHandler, getRouterParam } from "h3";

import {
  groupParam,
  integer,
  queryParam,
  requireItem,
} from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { store } = event.context.bot;
  const topic = requireItem(
    await store.topics.find(
      groupParam(event),
      getRouterParam(event, "topicId")!,
    ),
  );
  const version = queryParam(event, "version");

  if (!version) {
    return store.topics.sourceMessageIds(topic.id);
  }

  const note = requireItem(
    await store.notes.version(
      groupParam(event),
      getRouterParam(event, "topicId")!,
      version ? integer(version) : undefined,
    ),
  );

  return store.notes.sourceMessageIds(note);
});
