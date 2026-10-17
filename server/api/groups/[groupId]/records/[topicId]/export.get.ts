import {
  createError,
  defineEventHandler,
  getRouterParam,
  sendStream,
  setResponseHeaders,
} from "h3";

import { noteArchive } from "~~/server/note-export";
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

  if (topic.mode === "auto") {
    throw createError({
      statusCode: 409,
      message: "讨论草稿需先生成纪要，再导出",
    });
  }

  const version = queryParam(event, "version");
  const note = requireItem(
    await store.notes.version(
      groupId,
      topic.id,
      version ? integer(version) : undefined,
    ),
  );
  const title =
    topic.title.replace(/[\\/:*?"<>|\p{Cc}]/gu, "_").trim() || "纪要";
  const filename = encodeURIComponent(
    `${title} 第${note.revision}版.zip`,
  ).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  setResponseHeaders(event, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="note-${note.id}-v${note.revision}.zip"; filename*=UTF-8''${filename}`,
    "Cache-Control": "no-store",
  });

  const controller = new AbortController();
  const abort = () => controller.abort();

  event.node.res.once("close", abort);
  try {
    return await sendStream(event, noteArchive(store, note, controller.signal));
  } finally {
    event.node.res.off("close", abort);
    controller.abort();
  }
});
