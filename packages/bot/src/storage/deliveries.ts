import { EventEmitter, on } from "node:events";

import { Logger } from "@koishijs/core";
import type { Selectable } from "kysely";

import type { Delivery, Note } from "../types.ts";
import type { Database, Tables } from "./schema.ts";

type Outgoing = (
  | { kind: "text"; groupId: string; content: string }
  | { kind: "note"; note: Note; repeat?: boolean }
) & { replyTo?: string | null };

export class DeliveryQueue {
  #db: Database;
  #logger = new Logger("yanqi:delivery");
  #changes = new EventEmitter();

  constructor(db: Database) {
    this.#db = db;
  }

  public find(groupId: string, id: number) {
    return this.#db
      .selectFrom("deliveries")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  public async page(
    groupId: string,
    options: { offset: number; limit: number },
  ) {
    const query = this.#db
      .selectFrom("deliveries")
      .where("groupId", "=", groupId);
    const [items, total] = await Promise.all([
      query
        .selectAll()
        .orderBy("id", "desc")
        .offset(options.offset)
        .limit(options.limit)
        .execute(),
      query
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
    ]);

    return { items, total: total.count };
  }

  public async enqueueNote(
    note: Note,
    requestId?: number,
    replyTo: string | null = null,
  ) {
    return (await this.enqueueNotes([{ note, requestId }], "", replyTo))[0]!;
  }

  // 整批入队，发送器不会在后续纪要入队前抢先发出第一篇。
  public async enqueueNotes(
    notes: { note: Note; requestId: number | undefined }[],
    notification = "",
    replyTo: string | null = null,
  ) {
    const results = await this.#db.transaction().execute(async (db) => {
      const results = [];

      for (const { note, requestId } of notes) {
        results.push(
          await this.#enqueue(
            db,
            requestId === undefined
              ? `auto-note:${note.id}`
              : `requested:${requestId}:note:${note.id}`,
            { kind: "note", note, repeat: requestId !== undefined, replyTo },
          ),
        );
      }

      const first = results.find(
        ({ delivery }) => delivery.state === "pending",
      );

      if (first && notification) {
        await db
          .updateTable("deliveries")
          .set({ content: notification })
          .where("id", "=", first.delivery.id)
          .execute();
      }

      return results;
    });

    return results.map((result) => this.#completedEnqueue(result));
  }

  public async enqueue(key: string, outgoing: Outgoing) {
    return this.#completedEnqueue(
      await this.#db
        .transaction()
        .execute((db) => this.#enqueue(db, key, outgoing)),
    );
  }

  async #enqueue(db: Database, key: string, outgoing: Outgoing) {
    const note = outgoing.kind === "text" ? null : outgoing.note;
    const repeat = outgoing.kind === "note" && outgoing.repeat;
    let existing = await db
      .selectFrom("deliveries")
      .selectAll()
      .where("key", "=", key)
      .executeTakeFirst();
    const cancelled = note
      ? await db
          .updateTable("deliveries")
          .set({ state: "cancelled" })
          .where("noteId", "=", note.id)
          .where("kind", "=", "text")
          .where("state", "=", "pending")
          .returning("id")
          .execute()
      : [];

    if (!existing && note && !repeat) {
      existing = await db
        .selectFrom("deliveries")
        .selectAll()
        .where("noteId", "=", note.id)
        .where("state", "in", ["pending", "done"])
        .executeTakeFirst();
    }

    const delivery =
      existing ??
      (await db
        .insertInto("deliveries")
        .values({
          key,
          kind: outgoing.kind,
          groupId:
            outgoing.kind === "text" ? outgoing.groupId : outgoing.note.groupId,
          topicId: note?.topicId ?? null,
          noteId: note?.id ?? null,
          content: outgoing.kind === "text" ? outgoing.content : "",
          replyTo: outgoing.replyTo ?? null,
          createdAt: Date.now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow());

    if (!existing) {
      this.#logger.info(
        "发送 #%s 入队：key=%s group=%s kind=%s note=%s",
        delivery.id,
        key,
        delivery.groupId,
        delivery.kind,
        delivery.noteId,
      );
    }

    return { delivery, cancelled };
  }

  #completedEnqueue({
    delivery,
    cancelled,
  }: {
    delivery: Selectable<Tables["deliveries"]>;
    cancelled: { id: number }[];
  }) {
    for (const { id } of cancelled) {
      this.#changes.emit(String(id));
    }

    return { id: delivery.id, kind: delivery.kind, state: delivery.state };
  }

  public pendingNotes(groupId: string, replyTo: string | null) {
    return this.#db
      .selectFrom("deliveries")
      .selectAll()
      .where("groupId", "=", groupId)
      .where("kind", "=", "note")
      .where("replyTo", replyTo === null ? "is" : "=", replyTo)
      .where("state", "=", "pending")
      .orderBy("id")
      .execute();
  }

  public async isPending(id: number): Promise<boolean> {
    return (
      (await this.#db
        .selectFrom("deliveries")
        .select("id")
        .where("id", "=", id)
        .where("state", "=", "pending")
        .executeTakeFirst()) !== undefined
    );
  }

  public async wait(id: number, signal?: AbortSignal) {
    const changes = on(this.#changes, String(id), { signal });

    try {
      while (true) {
        signal?.throwIfAborted();
        const delivery = await this.#db
          .selectFrom("deliveries")
          .select("state")
          .where("id", "=", id)
          .executeTakeFirstOrThrow();

        if (delivery.state !== "pending") {
          return delivery.state;
        }

        await changes.next();
      }
    } finally {
      await changes.return!();
    }
  }

  public forRequest(requestId: number) {
    return this.#db
      .selectFrom("deliveries")
      .select(["id", "kind", "state", "noteId", "topicId"])
      .where((eb) =>
        eb.or([
          eb("key", "like", `requested:${requestId}:%`),
          eb("key", "=", `command:${requestId}`),
        ]),
      )
      .execute();
  }

  public forNote(noteId: number) {
    return this.#db
      .selectFrom("deliveries")
      .select(["id", "kind", "state", "createdAt"])
      .where("noteId", "=", noteId)
      .orderBy("id", "desc")
      .limit(5)
      .execute();
  }

  public async next(kind: Delivery["kind"]): Promise<Delivery | null> {
    return (
      (await this.#db
        .selectFrom("deliveries")
        .selectAll()
        .where("state", "=", "pending")
        .where("kind", "=", kind)
        .$if(kind === "note", (query) =>
          query.where(
            "groupId",
            "not in",
            this.#db
              .selectFrom("jobs")
              .select((eb) =>
                eb
                  .fn<string>("json_extract", ["payload", eb.val("$.groupId")])
                  .as("groupId"),
              )
              .where("kind", "in", ["intent", "detect", "summarize", "publish"])
              .where("state", "in", ["pending", "running"]),
          ),
        )
        .orderBy("id")
        .limit(1)
        .executeTakeFirst()) ?? null
    );
  }

  public async done(id: number): Promise<void> {
    await this.#db
      .updateTable("deliveries")
      .set({ state: "done" })
      .where("id", "=", id)
      .execute();
    this.#changes.emit(String(id));
  }

  public async cancel(id: number): Promise<void> {
    await this.#db
      .updateTable("deliveries")
      .set({ state: "cancelled" })
      .where("id", "=", id)
      .where("state", "=", "pending")
      .execute();
    this.#changes.emit(String(id));
  }

  public async fail(id: number): Promise<void> {
    await this.#db
      .updateTable("deliveries")
      .set({ state: "failed" })
      .where("id", "=", id)
      .execute();
    this.#changes.emit(String(id));
  }

  public async retryFailed(groupId: string): Promise<number> {
    const result = await this.#db
      .updateTable("deliveries")
      .set({ state: "pending" })
      .where("groupId", "=", groupId)
      .where("state", "=", "failed")
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }
}
