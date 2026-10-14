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
  interpretationPath,
  readInterpretation,
} from "./asset-files.ts";
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
      .where("assets.path", "=", assetPath(this.#directory, name))
      .limit(1)
      .executeTakeFirst();
  }

  public interpret(
    path: string,
    produce: () => Promise<string>,
  ): Promise<string> {
    const key = interpretationPath(path);
    const running = this.#interpreting.get(key);

    if (running) {
      return running;
    }

    const result = (async () => {
      const cached = await readInterpretation(path);

      if (cached !== null) {
        return cached;
      }

      const content = await produce();

      await writeMarkdown(key, content);

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

    return this.#db
      .selectFrom("assets")
      .selectAll()
      .where("messageId", "in", messageIds)
      .where("kind", "=", "image")
      .where("path", "is not", null)
      .execute();
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
    });
  }
}
