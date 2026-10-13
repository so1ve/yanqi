import { setTimeout as delay } from "node:timers/promises";

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

  constructor(db: Database) {
    this.#db = db;
  }

  public enqueue(key: string, outgoing: Outgoing): Promise<boolean> {
    return this.#db.transaction().execute(async (db) => {
      const note = outgoing.kind === "text" ? null : outgoing.note;
      const repeat = outgoing.kind === "note" && outgoing.repeat;
      let existing = await db
        .selectFrom("deliveries")
        .selectAll()
        .where("key", "=", key)
        .executeTakeFirst();

      if (note && outgoing.kind === "note") {
        await db
          .updateTable("deliveries")
          .set({ state: "cancelled" })
          .where("noteId", "=", note.id)
          .where("kind", "=", "text")
          .where("state", "=", "pending")
          .execute();
      }

      if (!existing && note) {
        existing = (
          await db
            .selectFrom("deliveries")
            .selectAll()
            .where("noteId", "=", note.id)
            .execute()
        ).find((item) =>
          repeat
            ? item.kind === "note" && item.state === "pending"
            : item.state === "pending" || item.state === "done",
        );
      }

      if (existing) {
        this.#logger.debug(
          "忽略重复发送：key=%s existing=%s",
          key,
          existing.id,
        );

        return false;
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

      return true;
    });
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

  public async wait(key: string, signal?: AbortSignal) {
    const deadline = Date.now() + 40_000;

    while (true) {
      signal?.throwIfAborted();
      const delivery = await this.#db
        .selectFrom("deliveries")
        .select("state")
        .where("key", "=", key)
        .executeTakeFirst();

      if (!delivery) {
        throw new Error("回复尚未提交发送");
      }

      if (delivery.state !== "pending" || Date.now() >= deadline) {
        return delivery.state;
      }

      await delay(100, undefined, { signal });
    }
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
  }

  public async cancel(id: number): Promise<void> {
    await this.#db
      .updateTable("deliveries")
      .set({ state: "cancelled" })
      .where("id", "=", id)
      .where("state", "=", "pending")
      .execute();
  }

  public async fail(id: number): Promise<void> {
    await this.#db
      .updateTable("deliveries")
      .set({ state: "failed" })
      .where("id", "=", id)
      .execute();
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
