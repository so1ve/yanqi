import { defineEventHandler, getRouterParam } from "h3";

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
  const versions = await db.get(
    "notes",
    { topicId: topic.id },
    {
      fields: ["id", "revision", "createdAt", "sourceThrough"],
      sort: { revision: "desc" },
    },
  );
  const id = queryParam(event, "version")
    ? integer(queryParam(event, "version"))
    : versions[0]?.id;
  const note =
    id === undefined
      ? null
      : requireItem((await db.get("notes", { id, topicId: topic.id }))[0]);
  const tasks = await bot.store.jobs.forTopic(topic.id);

  return { topic, note, versions, tasks };
});
