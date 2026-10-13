import type { Note } from "@yanqi/bot";
import { decodeNote } from "@yanqi/bot";
import { defineEventHandler, getRouterParam } from "h3";

import { messageDetails } from "~~/server/messages";
import {
  groupParam,
  integer,
  pagination,
  queryParam,
  requireItem,
} from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const db = bot.database;
  const groupId = groupParam(event);
  const topicId = getRouterParam(event, "topicId")!;
  const version = queryParam(event, "version");
  let notes = db
    .selectFrom("notes")
    .selectAll()
    .where("groupId", "=", groupId)
    .where("topicId", "=", topicId);

  if (version) {
    notes = notes.where("id", "=", integer(version));
  }

  const note = decodeNote(
    requireItem(
      await notes.orderBy("revision", "desc").limit(1).executeTakeFirst(),
    ),
  );
  let sections = note.sections;

  // 手工编辑只改正文，原文沿用此前最近一次整理的版本。
  if (sections.length === 0) {
    const earlier = await db
      .selectFrom("notes")
      .select("sections")
      .where("groupId", "=", groupId)
      .where("topicId", "=", topicId)
      .where("revision", "<", note.revision)
      .orderBy("revision", "desc")
      .execute();

    sections =
      earlier
        .map((row): Note["sections"] => JSON.parse(row.sections))
        .find((items) => items.length > 0) ?? [];
  }

  const ids = [...new Set(sections.flatMap((section) => section.messageIds))];
  const query = db
    .selectFrom("messages")
    .where("groupId", "=", groupId)
    .where("id", "in", ids);
  const { page, limit, offset } = pagination(event);
  const [messages, total] = await Promise.all([
    query
      .selectAll()
      .orderBy("sentAt")
      .orderBy("id")
      .limit(limit)
      .offset(offset)
      .execute(),
    query
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow(),
  ]);

  return {
    items: await messageDetails(bot, groupId, messages),
    total: total.count,
    page,
    limit,
  };
});
