import { rm, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { Note } from "../types.ts";
import { interpretationPath } from "./asset-files.ts";
import { decodeJob } from "./jobs.ts";
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

  for (const group of await db.selectFrom("groups").select("id").execute()) {
    let after = 0;

    while (true) {
      const batch = await db.transaction().execute(async (db) => {
        const downloading = await db
          .selectFrom("jobs")
          .select("id")
          .where("kind", "=", "asset")
          .where("state", "=", "running")
          .limit(1)
          .executeTakeFirst();
        const jobs = (
          await db
            .selectFrom("jobs")
            .selectAll()
            .where((eb) =>
              eb(
                eb.fn<string>("json_extract", ["payload", eb.val("$.groupId")]),
                "=",
                group.id,
              ),
            )
            .execute()
        ).map(decodeJob);

        // 对话可以回查任意历史；后台任务也可能仍在读取附件或原文。
        if (
          downloading !== undefined ||
          jobs.some(
            (job) =>
              job.state === "running" ||
              (job.kind === "intent" && job.state === "pending"),
          )
        ) {
          return { skipped: true, through: after };
        }

        const messages = await db
          .selectFrom("messages")
          .select("id")
          .where("groupId", "=", group.id)
          .where("sentAt", "<", cutoff)
          .where("id", ">", after)
          .orderBy("id")
          .limit(500)
          .execute();

        if (messages.length === 0) {
          return null;
        }

        const ids = messages.map(({ id }) => id);
        const links = await db
          .selectFrom("topic_messages")
          .select("messageId")
          .where("messageId", "in", ids)
          .execute();
        const memories = await db
          .selectFrom("memories")
          .select("sourceMessageId")
          .where("sourceMessageId", "in", ids)
          .execute();
        const topics = await db
          .selectFrom("topics")
          .select(["directiveMessageId", "endedAtMessageId"])
          .where("groupId", "=", group.id)
          .execute();
        const notes = await db
          .selectFrom("notes")
          .select("sections")
          .where("groupId", "=", group.id)
          .execute();
        const protectedIds = new Set<number | null>([
          ...links.map((link) => link.messageId),
          ...memories.map((memory) => memory.sourceMessageId),
          ...topics.flatMap((topic) => [
            topic.directiveMessageId,
            topic.endedAtMessageId,
          ]),
          // 历史版本可能引用已经移出当前话题的消息。
          ...notes.flatMap((note) => {
            const sections: Note["sections"] = JSON.parse(note.sections);

            return sections.flatMap((section) => section.messageIds);
          }),
          ...jobs
            .filter(
              (job) => job.state === "pending" && "messageIds" in job.payload,
            )
            .flatMap((job) =>
              "messageIds" in job.payload ? job.payload.messageIds : [],
            ),
        ]);
        const expired = ids.filter((id) => !protectedIds.has(id));
        const assets = await db
          .selectFrom("assets")
          .select(["id", "path"])
          .where("messageId", "in", expired)
          .execute();

        for (const path of new Set(
          assets.flatMap((asset) => (asset.path ? [asset.path] : [])),
        )) {
          const retained = await db
            .selectFrom("assets")
            .select("id")
            .where("path", "=", path)
            .where("messageId", "not in", expired)
            .limit(1)
            .executeTakeFirst();

          if (retained) {
            continue;
          }

          if (!resolve(path).startsWith(root)) {
            throw new Error("待清理附件不在数据目录中");
          }

          for (const file of [path, interpretationPath(path)]) {
            const info = await stat(file).catch(
              (error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") {
                  throw error;
                }

                return null;
              },
            );

            await rm(file, { force: true });
            if (info) {
              result.files++;
              result.bytes += info.size;
            }
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

        await db
          .deleteFrom("jobs")
          .where(
            "id",
            "in",
            obsoleteJobs.map((job) => job.id),
          )
          .execute();
        await db
          .deleteFrom("assets")
          .where("messageId", "in", expired)
          .execute();
        await db.deleteFrom("messages").where("id", "in", expired).execute();
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
