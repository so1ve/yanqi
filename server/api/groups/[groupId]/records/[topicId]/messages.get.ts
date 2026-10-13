import { $ } from "@koishijs/core";
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
  const db = event.context.bot.database;
  const groupId = groupParam(event);
  const topicId = getRouterParam(event, "topicId")!;
  const version = queryParam(event, "version");
  const note = requireItem(
    (
      await db.get(
        "notes",
        {
          groupId,
          topicId,
          ...(version ? { id: integer(version) } : {}),
        },
        { sort: { revision: "desc" }, limit: 1 },
      )
    )[0],
  );
  let sections = note.sections;

  // 手工编辑只改正文，原文沿用此前最近一次整理的版本。
  if (sections.length === 0) {
    const earlier = await db.get(
      "notes",
      {
        groupId,
        topicId,
        revision: { $lt: note.revision },
      },
      { fields: ["sections"], sort: { revision: "desc" } },
    );

    sections = earlier.find((item) => item.sections.length > 0)?.sections ?? [];
  }

  const ids = [...new Set(sections.flatMap((section) => section.messageIds))];
  const query = { groupId, id: ids };
  const { page, limit, offset } = pagination(event);
  const [messages, total] = await Promise.all([
    db.get("messages", query, {
      sort: { sentAt: "asc", id: "asc" },
      limit,
      offset,
    }),
    db.eval("messages", (row) => $.count(row.id), query),
  ]);

  return {
    items: await messageDetails(db, groupId, messages),
    total,
    page,
    limit,
  };
});
