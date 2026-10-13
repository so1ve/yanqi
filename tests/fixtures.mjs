import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseConfig } from "../packages/bot/src/config.ts";
import { Store } from "../packages/bot/src/storage/store.ts";
import { Accounts } from "../server/storage/accounts.ts";
import { openDatabases } from "../server/storage/database.ts";

export async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "yanqi-storage-"));
  let databases;

  t.after(async () => {
    try {
      if (databases) {
        await databases.bot.destroy();
        await databases.management.destroy();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  databases = await openDatabases(directory);
  const store = new Store(databases.bot, directory, parseConfig({}));

  await store.groups.ensure(["100", "200"]);

  return { store, directory, accounts: new Accounts(databases.management) };
}

export const capture = (store, groupId, messageId, fields = {}) =>
  store.inbox.capture({
    groupId,
    messageId,
    userId: "101",
    displayName: "Kat",
    sentAt: 1000,
    receivedAt: 1000,
    text: "讨论内容",
    content: [{ type: "text", data: { text: "讨论内容" } }],
    replyTo: null,
    isBot: false,
    addressed: false,
    role: "owner",
    ...fields,
  });

export async function savedNote(store, directory, message) {
  const { topic, taskId } = await store.recordings.createSummary(
    message.groupId,
    "部署讨论",
    "整理已确定的方案",
    [message.id],
  );
  const versionDirectory = join(
    directory,
    "groups",
    topic.groupId,
    "topics",
    topic.id,
    "v1",
  );
  const markdown = "# 部署讨论\n\n第 1 版 · 1 条原始消息\n\n使用 Docker。";
  const path = join(versionDirectory, "note.md");

  await mkdir(versionDirectory, { recursive: true });
  await writeFile(path, markdown);
  await writeFile(join(versionDirectory, "transcript.md"), "原始讨论");
  const note = await store.notes.save(
    topic.id,
    message.id,
    topic.generation,
    markdown,
    [{ messageIds: [message.id], content: "使用 Docker。" }],
    path,
    1000,
  );

  await store.jobs.done(taskId);

  return note;
}
