import type { Note } from "@yanqi/bot";
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
  const messages = await db
    .selectFrom("messages")
    .select("id")
    .where("groupId", "=", groupId)
    .where("id", "in", ids)
    .orderBy("sentAt")
    .orderBy("id")
    .execute();

  return messages.map((message) => message.id);
});
