import assert from "node:assert/strict";

import { sql } from "kysely";

import {
  attachmentReference,
  forwardAttachments,
  forwardMessages,
} from "../onebot/content.ts";
import type { Asset, Segment } from "../types.ts";
import {
  assetPath,
  imageMimeType,
  interpretationPath,
  readInterpretation,
} from "./asset-files.ts";
import { StoreError, required } from "./errors.ts";
import { writeMarkdown } from "./files.ts";
import { enqueueJob } from "./jobs.ts";
import type { Database } from "./schema.ts";
import { messageChanged } from "./topic-sources.ts";

export interface AssetMetadata {
  count: number;
  pending: number;
  failed: number;
  parsedTextChars: number;
  forwardedMessages: number;
}

export async function captureAssets(
  db: Database,
  message: { id: number; groupId: string },
  content: Iterable<Segment>,
): Promise<void> {
  for (const segment of content) {
    const reference = attachmentReference(segment);

    if (!reference) {
      continue;
    }

    const asset = await db
      .insertInto("assets")
      .values({ messageId: message.id, ...reference })
      .onConflict((conflict) =>
        conflict.columns(["messageId", "kind", "reference"]).doNothing(),
      )
      .returning("id")
      .executeTakeFirst();

    if (asset) {
      await enqueueJob(db, "asset", `asset:${asset.id}`, {
        assetId: asset.id,
        groupId: message.groupId,
      });
    }
  }
}

export class Assets {
  #db: Database;
  #directory: string;
  #interpreting = new Map<string, Promise<string>>();

  constructor(db: Database, directory: string) {
    this.#db = db;
    this.#directory = directory;
  }

  public find(groupId: string, id: number) {
    return this.#db
      .selectFrom("assets")
      .innerJoin("messages", "messages.id", "assets.messageId")
      .selectAll("assets")
      .where("assets.id", "=", id)
      .where("messages.groupId", "=", groupId)
      .executeTakeFirst();
  }

  public forMessages(messageIds: number[]): Promise<Asset[]> {
    if (messageIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.#db
      .selectFrom("assets")
      .selectAll()
      .where("messageId", "in", messageIds)
      .execute();
  }

  public async metadata(messageIds: number[]): Promise<AssetMetadata> {
    const selection = this.#db
      .selectFrom("assets")
      .where("messageId", "in", messageIds);
    const [assets, forwards] = await Promise.all([
      selection
        .select((eb) => [
          eb.fn.countAll<number>().as("count"),
          eb.fn
            .countAll<number>()
            .filterWhere("state", "=", "pending")
            .as("pending"),
          eb.fn
            .countAll<number>()
            .filterWhere("state", "=", "failed")
            .as("failed"),
          eb.fn
            .coalesce(
              eb.fn
                .sum<number>(eb.fn<number>("length", ["interpretation"]))
                .filterWhere("kind", "!=", "forward"),
              eb.val(0),
            )
            .as("parsedTextChars"),
        ])
        .executeTakeFirstOrThrow(),
      sql<{ messages: number; textChars: number }>`
        select count(*) filter (where node.key = 'sender' and node.type = 'object') as messages,
          coalesce(sum(length(node.value)) filter (where node.key = 'text' and node.type = 'text'), 0) as textChars
        from (${selection.where("kind", "=", "forward").select("interpretation")}) as cards,
          json_tree(cards.interpretation) as node
      `.execute(this.#db),
    ]);
    const forward = forwards.rows[0]!;

    return {
      ...assets,
      forwardedMessages: forward.messages,
      parsedTextChars: assets.parsedTextChars + forward.textChars,
    };
  }

  public capture(
    message: { id: number; groupId: string },
    content: Iterable<Segment>,
  ): Promise<void> {
    return this.#db
      .transaction()
      .execute((db) => captureAssets(db, message, content));
  }

  public async inForward(asset: Asset): Promise<Asset[]> {
    if (asset.kind !== "forward" || !asset.interpretation) {
      return [];
    }

    const references = new Set(
      [
        ...forwardAttachments(
          forwardMessages(JSON.parse(asset.interpretation)),
        ),
      ].map((segment) => {
        const ref = attachmentReference(segment)!;

        return `${ref.kind}:${ref.reference}`;
      }),
    );

    return (await this.forMessage(asset.messageId)).filter((child) =>
      references.has(`${child.kind}:${child.reference}`),
    );
  }

  public async file(groupId: string, name: string): Promise<Asset | undefined> {
    return this.#db
      .selectFrom("assets")
      .innerJoin("messages", "messages.id", "assets.messageId")
      .selectAll("assets")
      .where("messages.groupId", "=", groupId)
      .where(
        "assets.path",
        "in",
        (["image", "audio", "video", "file", "forward"] as const).map((kind) =>
          assetPath(this.#directory, kind, name),
        ),
      )
      .limit(1)
      .executeTakeFirst();
  }

  public async listImages(
    groupId: string,
    query: string | undefined,
    before: number | undefined,
  ) {
    let selection = this.#db
      .selectFrom("assets")
      .innerJoin("messages", "messages.id", "assets.messageId")
      .where("messages.groupId", "=", groupId)
      .where((eb) =>
        eb.or([
          eb("assets.kind", "=", "image"),
          eb("assets.path", "like", `${this.#directory}/assets/images/%`),
        ]),
      );

    if (query) {
      const id = /^(?:asset:|#)?(\d+)$/i.exec(query);

      selection = id
        ? selection.where("assets.id", "=", Number(id[1]))
        : selection.where((eb) =>
            eb(
              eb.fn<number>("contains_text", [
                "assets.interpretation",
                eb.val(query),
              ]),
              "=",
              1,
            ),
          );
    }

    if (before !== undefined) {
      selection = selection.where("assets.id", "<", before);
    }

    const rows = await selection
      .selectAll("assets")
      .select("messages.sentAt")
      .orderBy("assets.id", "desc")
      .limit(41)
      .execute();

    return {
      items: rows
        .slice(0, 40)
        .map(({ path, reference: _reference, ...asset }) => ({
          ...asset,
          available: Boolean(path && asset.state !== "missing"),
        })),
      next: rows.length > 40 ? rows[39]!.id : null,
    };
  }

  public async retry(groupId: string, id: number): Promise<number> {
    return this.#db.transaction().execute(async (db) => {
      const asset = required(
        await db
          .selectFrom("assets")
          .innerJoin("messages", "messages.id", "assets.messageId")
          .selectAll("assets")
          .where("messages.groupId", "=", groupId)
          .where("assets.id", "=", id)
          .executeTakeFirst(),
      );
      const related = await db
        .selectFrom("assets")
        .select("id")
        .where((eb) =>
          eb.or([
            eb("id", "=", id),
            ...(asset.path ? [eb("path", "=", asset.path)] : []),
          ]),
        )
        .execute();
      const jobs = await db
        .selectFrom("jobs")
        .selectAll()
        .where("kind", "=", "asset")
        .where((eb) =>
          eb(
            eb.fn<number>("json_extract", ["payload", eb.val("$.assetId")]),
            "in",
            related.map((item) => item.id),
          ),
        )
        .execute();

      if (
        jobs.some((job) => job.state === "running" || job.state === "pending")
      ) {
        throw new StoreError("conflict", "这份资源已经在处理中，请等待完成");
      }

      const job = jobs.find((job) => JSON.parse(job.payload).assetId === id);

      assert.ok(job, `附件 #${id} 缺少处理任务`);
      await db
        .updateTable("jobs")
        .set({
          payload: JSON.stringify({ groupId, assetId: id, refresh: true }),
          state: "pending",
          attempts: 0,
          runAfter: Date.now(),
          lastError: null,
          progress: null,
        })
        .where("id", "=", job.id)
        .execute();

      return job.id;
    });
  }

  public interpret(
    path: string,
    produce: () => Promise<string>,
    refresh = false,
  ): Promise<string> {
    const key = interpretationPath(path);
    const running = this.#interpreting.get(key);

    if (running) {
      return refresh
        ? running
            .catch(() => undefined)
            .then(() => this.interpret(path, produce, true))
        : running;
    }

    const result = (async () => {
      const cached = refresh ? null : await readInterpretation(path);
      const content = cached ?? (await produce());

      if (cached === null) {
        await writeMarkdown(key, content);
      }

      // 一个原件只存一份识别结果；更新所有群中对同一原件的引用。
      await this.#db.transaction().execute(async (db) => {
        const assets = await db
          .selectFrom("assets")
          .select(["id", "messageId", "interpretation", "error", "state"])
          .where("path", "=", path)
          .execute();

        for (const asset of assets) {
          if (
            asset.interpretation === content &&
            asset.error === null &&
            asset.state === "saved"
          ) {
            continue;
          }

          await db
            .updateTable("assets")
            .set({ interpretation: content, error: null, state: "saved" })
            .where("id", "=", asset.id)
            .execute();
          await messageChanged(db, asset.messageId);
        }
      });

      return content;
    })().finally(() => this.#interpreting.delete(key));

    this.#interpreting.set(key, result);

    return result;
  }

  public async get(id: number): Promise<Asset> {
    const asset = await this.#db
      .selectFrom("assets")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    if (!asset) {
      throw new Error(`不存在的附件 ${id}`);
    }

    return asset;
  }

  public forMessage(messageId: number): Promise<Asset[]> {
    return this.#db
      .selectFrom("assets")
      .selectAll()
      .where("messageId", "=", messageId)
      .orderBy("id")
      .execute();
  }

  public async images(messageIds: number[]): Promise<Asset[]> {
    if (messageIds.length === 0) {
      return [];
    }

    const assets = await this.#db
      .selectFrom("assets")
      .selectAll()
      .where("messageId", "in", messageIds)
      .where("path", "is not", null)
      .execute();

    return assets.filter((asset) => imageMimeType(asset.path!));
  }

  public async save(
    id: number,
    state: Asset["state"],
    path: string | null,
    interpretation: string | null,
    error: string | null,
  ): Promise<void> {
    await this.#db.transaction().execute(async (db) => {
      const asset = await db
        .selectFrom("assets")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      assert.ok(asset);
      if (
        asset.state === state &&
        asset.path === path &&
        asset.interpretation === interpretation &&
        asset.error === error
      ) {
        return;
      }

      await db
        .updateTable("assets")
        .set({ state, path, interpretation, error })
        .where("id", "=", id)
        .execute();
      await messageChanged(db, asset.messageId);
      if (state === "saved" && path) {
        const restored = await db
          .updateTable("assets")
          .set({ state: "saved", error: null })
          .where("path", "=", path)
          .where("state", "=", "missing")
          .returning("messageId")
          .execute();

        for (const reference of restored) {
          await messageChanged(db, reference.messageId);
        }
      }
    });
  }
}
