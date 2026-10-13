import { EventEmitter, on } from "node:events";

import { Logger } from "@koishijs/core";

import type { Delivery, Note } from "../types.ts";
import type { Database } from "./schema.ts";

type Outgoing =
  | { kind: "text"; groupId: string; content: string }
  | { kind: "note"; note: Note; repeat?: boolean }
  | { kind: "saved"; note: Note; content: string };

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

  public enqueueNote(note: Note, requestId?: number) {
    return this.enqueue(
      requestId === undefined
        ? `auto-note:${note.id}`
        : `requested:${requestId}:note:${note.id}`,
      { kind: "note", note, repeat: requestId !== undefined },
    );
  }

  public async enqueue(key: string, outgoing: Outgoing) {
    let cancelled: { id: number }[] = [];
    const delivery = await this.#db.transaction().execute(async (db) => {
      const note = outgoing.kind === "text" ? null : outgoing.note;
      const repeat = outgoing.kind === "note" && outgoing.repeat;
      let existing = await db
        .selectFrom("deliveries")
        .selectAll()
        .where("key", "=", key)
        .executeTakeFirst();

      if (note && outgoing.kind === "note") {
        cancelled = await db
          .updateTable("deliveries")
          .set({ state: "cancelled" })
          .where("noteId", "=", note.id)
          .where("kind", "=", "text")
          .where("state", "=", "pending")
          .returning("id")
          .execute();
      }

      if (!existing && note && !repeat) {
        existing = await db
          .selectFrom("deliveries")
          .selectAll()
          .where("noteId", "=", note.id)
          .where("state", "in", ["pending", "done"])
          .executeTakeFirst();
      }

      if (existing) {
        this.#logger.debug(
          "忽略重复发送：key=%s existing=%s",
          key,
          existing.id,
        );

        return existing;
      }

      const delivery = await db
        .insertInto("deliveries")
        .values({
          key,
          kind: outgoing.kind === "saved" ? "text" : outgoing.kind,
          groupId:
            outgoing.kind === "text" ? outgoing.groupId : outgoing.note.groupId,
          topicId: note?.topicId ?? null,
          noteId: note?.id ?? null,
          content:
            outgoing.kind === "text"
              ? outgoing.content
              : outgoing.kind === "saved"
                ? outgoing.content
                : "",
          createdAt: Date.now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      this.#logger.info(
        "发送 #%s 入队：key=%s group=%s kind=%s note=%s",
        delivery.id,
        key,
        delivery.groupId,
        delivery.kind,
        delivery.noteId,
      );

      return delivery;
    });

    for (const { id } of cancelled) {
      this.#changes.emit(String(id));
    }

    return { id: delivery.id, kind: delivery.kind, state: delivery.state };
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
