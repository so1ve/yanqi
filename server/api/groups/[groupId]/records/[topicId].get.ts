import { decodeNote } from "@yanqi/bot";
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
    await db
      .selectFrom("topics")
      .selectAll()
      .where("id", "=", getRouterParam(event, "topicId")!)
      .where("groupId", "=", groupId)
      .executeTakeFirst(),
  );
  const versions = await db
    .selectFrom("notes")
    .select(["id", "revision", "createdAt", "sourceThrough"])
    .where("topicId", "=", topic.id)
    .orderBy("revision", "desc")
    .execute();
  const id = queryParam(event, "version")
    ? integer(queryParam(event, "version"))
    : versions[0]?.id;
  const note =
    id === undefined
      ? null
      : decodeNote(
          requireItem(
            await db
              .selectFrom("notes")
              .selectAll()
              .where("id", "=", id)
              .where("topicId", "=", topic.id)
              .executeTakeFirst(),
          ),
        );
  const tasks = await bot.store.jobs.forTopic(topic.id);

  return { topic, note, versions, tasks };
});
