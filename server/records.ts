import type { Yanqi } from "@yanqi/bot";
import { createError } from "h3";

import { storeOperation } from "./utils/http";

export const editNote = (
  bot: Yanqi,
  groupId: string,
  topicId: string,
  input: { noteId: number; markdown: string },
) => storeOperation(() => bot.store.notes.edit(groupId, topicId, input));

export async function regenerateRecord(
  bot: Yanqi,
  groupId: string,
  topicId: string,
  focus: string,
) {
  if (!bot.config.GROUP_IDS.includes(groupId)) {
    throw createError({
      statusCode: 409,
      message: "请先在“群与成员”中启用该群的“保存消息”",
    });
  }

  const taskId = await storeOperation(() =>
    bot.store.topics.regenerate(groupId, topicId, focus),
  );

  bot.wake();

  return { taskId };
}

export async function deleteRecord(
  bot: Yanqi,
  groupId: string,
  topicId: string,
): Promise<void> {
  if (bot.running) {
    throw createError({ statusCode: 409, message: "请先暂停 AI，再删除纪要" });
  }

  await storeOperation(() => bot.store.topics.remove(groupId, topicId));
}
