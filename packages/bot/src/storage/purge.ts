import { rm, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { Database } from "./schema.ts";

export async function purgeHistory(
  db: Database,
  directory: string,
  days: number,
) {
  const result = {
    messages: 0,
    assets: 0,
    files: 0,
    bytes: 0,
    skippedGroups: 0,
  };

  if (days === 0) {
    return result;
  }

  const cutoff = Date.now() - days * 86_400_000;
  const root = `${resolve(directory)}${sep}`;

  for (const group of await db.get("groups", {}, ["id"])) {
    let after = 0;

    while (true) {
      const batch = await db.transact(async (db) => {
        const downloading = await db.get(
          "jobs",
          { kind: "asset", state: "running" },
          { fields: ["id"], limit: 1 },
        );
        const jobs = await db.get(
          "jobs",
          { "payload.groupId": group.id },
          {
            fields: ["id", "kind", "payload", "state"],
          },
        );

        // 对话可以回查任意历史；后台任务也可能仍在读取附件或原文。
        if (
          downloading.length > 0 ||
          jobs.some(
            (job) =>
              job.state === "running" ||
              (job.kind === "intent" && job.state === "pending"),
          )
        ) {
          return { skipped: true, through: after };
        }

        const messages = await db.get(
          "messages",
          {
            groupId: group.id,
            sentAt: { $lt: cutoff },
            id: { $gt: after },
          },
          { fields: ["id"], sort: { id: "asc" }, limit: 500 },
        );

        if (messages.length === 0) {
          return null;
        }

        const ids = messages.map(({ id }) => id);
        const links = await db.get("topic_messages", { messageId: ids }, [
          "messageId",
        ]);
        const memories = await db.get("memories", { sourceMessageId: ids }, [
          "sourceMessageId",
        ]);
        const topics = await db.get("topics", { groupId: group.id }, [
          "directiveMessageId",
          "endedAtMessageId",
        ]);
        const notes = await db.get("notes", { groupId: group.id }, [
          "sections",
        ]);
        const protectedIds = new Set<number | null>([
          ...links.map((link) => link.messageId),
          ...memories.map((memory) => memory.sourceMessageId),
          ...topics.flatMap((topic) => [
            topic.directiveMessageId,
            topic.endedAtMessageId,
          ]),
          // 历史版本可能引用已经移出当前话题的消息。
          ...notes.flatMap((note) =>
            note.sections.flatMap((section) => section.messageIds),
          ),
          ...jobs
            .filter(
              (job) => job.state === "pending" && "messageIds" in job.payload,
            )
            .flatMap((job) =>
              "messageIds" in job.payload ? job.payload.messageIds : [],
            ),
        ]);
        const expired = ids.filter((id) => !protectedIds.has(id));
        const assets = await db.get("assets", { messageId: expired }, [
          "id",
          "path",
        ]);

        for (const path of new Set(
          assets.flatMap((asset) => (asset.path ? [asset.path] : [])),
        )) {
          const retained = await db.get(
            "assets",
            { path, messageId: { $nin: expired } },
            { fields: ["id"], limit: 1 },
          );

          if (retained.length > 0) {
            continue;
          }

          if (!resolve(path).startsWith(root)) {
            throw new Error("待清理附件不在数据目录中");
          }

          const info = await stat(path).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") {
                throw error;
              }

              return null;
            },
          );

          await rm(path, { force: true });
          if (info) {
            result.files++;
            result.bytes += info.size;
          }
        }

        const messageIds = new Set(expired);
        const assetIds = new Set(assets.map((asset) => asset.id));
        const obsoleteJobs = jobs.filter(
          ({ payload }) =>
            ("assetId" in payload && assetIds.has(payload.assetId)) ||
            ("messageId" in payload && messageIds.has(payload.messageId)) ||
            ("messageIds" in payload &&
              payload.messageIds.some((id) => messageIds.has(id))),
        );

        await db.remove("jobs", { id: obsoleteJobs.map((job) => job.id) });
        await db.remove("assets", { messageId: expired });
        await db.remove("messages", { id: expired });
        result.messages += expired.length;
        result.assets += assets.length;

        return { skipped: false, through: messages.at(-1)!.id };
      });

      if (!batch) {
        break;
      }

      if (batch.skipped) {
        result.skippedGroups++;

        break;
      }

      after = batch.through;
    }
  }

  return result;
}
