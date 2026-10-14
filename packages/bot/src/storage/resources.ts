import type { Dirent } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { join, relative } from "node:path";

import { interpretationPath } from "./asset-files.ts";
import type { Database } from "./schema.ts";
import { messageChanged } from "./topic-sources.ts";

export const resourceKinds = [
  "images",
  "imageDescriptions",
  "files",
  "audio",
  "transcriptions",
  "video",
  "forwards",
] as const;
export type ResourceKind = (typeof resourceKinds)[number];

const location = (kind: ResourceKind) => ({
  directory:
    kind === "imageDescriptions"
      ? "images"
      : kind === "transcriptions"
        ? "audio"
        : kind,
  cache: kind === "imageDescriptions" || kind === "transcriptions",
});

export class Resources {
  constructor(
    private db: Database,
    private directory: string,
  ) {}

  async #entries(kind: ResourceKind) {
    const { directory, cache } = location(kind);
    const root = join(this.directory, "assets", directory);
    const assets = await this.db
      .selectFrom("assets")
      .select(["id", "messageId", "path", "state"])
      .select((eb) => eb("interpretation", "is not", null).as("interpreted"))
      .where("path", "like", `${root}/%`)
      .execute();
    const entries = new Map<
      string,
      { bytes: number | null; assets: typeof assets }
    >();
    let files: Dirent[];

    try {
      files = await readdir(root, { recursive: true, withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      files = [];
    }

    for (const file of files) {
      if (!file.isFile()) {
        continue;
      }

      const path = join(file.parentPath, file.name);

      if (
        !/^[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{64}\.[a-z0-9]+$/.test(
          relative(root, path),
        )
      ) {
        continue;
      }

      if (file.name.endsWith(".md") !== cache) {
        continue;
      }

      try {
        entries.set(path, { bytes: (await stat(path)).size, assets: [] });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }

    for (const asset of assets) {
      if (
        !/^[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{64}\.[a-z0-9]+$/.test(
          relative(root, asset.path!),
        )
      ) {
        continue;
      }

      const path = cache ? interpretationPath(asset.path!) : asset.path!;
      let entry = entries.get(path);

      if (!entry) {
        entry = { bytes: null, assets: [] };
        entries.set(path, entry);
      }

      entry.assets.push(asset);
    }

    return entries;
  }

  public async stats() {
    return Promise.all(
      resourceKinds.map(async (kind) => {
        const entries = [...(await this.#entries(kind)).values()];
        const { cache } = location(kind);

        return {
          kind,
          files: entries.filter((entry) => entry.bytes !== null).length,
          bytes: entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
          references: entries
            .flatMap((entry) => entry.assets)
            .filter((asset) =>
              cache ? asset.interpreted : asset.state !== "missing",
            ).length,
        };
      }),
    );
  }

  // 调用方在暂停 AI 后串行清理，下载、识别与发送均已结束。
  public async clear(kind: ResourceKind) {
    const entries = await this.#entries(kind);
    const { cache } = location(kind);
    let files = 0;
    let bytes = 0;

    for (const [path, entry] of entries) {
      try {
        await unlink(path);
        files += 1;
        bytes += entry.bytes ?? 0;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      await this.db.transaction().execute(async (db) => {
        for (const asset of entry.assets) {
          await db
            .updateTable("assets")
            .set(
              cache
                ? { interpretation: null, error: null }
                : {
                    state: "missing",
                    error: "原件已清理",
                    ...(kind === "forwards" ? { interpretation: null } : {}),
                  },
            )
            .where("id", "=", asset.id)
            .execute();
          // 保留路径和引用，但不让旧任务在恢复 AI 时重新下载或重建缓存。
          await db
            .updateTable("jobs")
            .set({
              state: "done",
              lastError: null,
              progress: "资源已由管理员清理",
            })
            .where("kind", "=", "asset")
            .where((eb) =>
              eb(
                eb.fn<number>("json_extract", ["payload", eb.val("$.assetId")]),
                "=",
                asset.id,
              ),
            )
            .execute();
          await messageChanged(db, asset.messageId);
        }
      });
    }

    return { files, bytes };
  }
}
