import { defineEventHandler, getRouterParam } from "h3";

import {
  groupParam,
  integer,
  queryParam,
  requireItem,
} from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { store } = event.context.bot;
  const groupId = groupParam(event);
  const topic = requireItem(
    await store.topics.find(groupId, getRouterParam(event, "topicId")!),
  );
  const versions = await store.notes.versions(topic.id);
  const version = queryParam(event, "version");
  const id = version ? integer(version) : versions[0]?.id;
  const note =
    id === undefined
      ? null
      : requireItem(await store.notes.version(groupId, topic.id, id));
  const tasks = await store.jobs.forTopic(topic.id);

  return { topic, note, versions, tasks };
});
