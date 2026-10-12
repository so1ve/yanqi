import { setTimeout as delay } from "node:timers/promises";

import { Logger } from "koishi";

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
    return this.#db.transact(async (db) => {
      const note = outgoing.kind === "text" ? null : outgoing.note;
      const repeat = outgoing.kind === "note" && outgoing.repeat;
      let [existing] = await db.get("deliveries", { key });

      if (note && outgoing.kind === "note") {
        await db.set(
          "deliveries",
          { noteId: note.id, kind: "text", state: "pending" },
          { state: "cancelled" },
        );
      }

      if (!existing && note) {
        existing = (await db.get("deliveries", { noteId: note.id })).find(
          (item) =>
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
      } else {
        const delivery = await db.create("deliveries", {
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
        });

        this.#logger.info(
          "发送 #%s 入队：key=%s group=%s kind=%s note=%s",
          delivery.id,
          key,
          delivery.groupId,
          delivery.kind,
          delivery.noteId,
        );

        return true;
      }
    });
  }

  public async isPending(id: number): Promise<boolean> {
    return (
      (await this.#db.get("deliveries", { id, state: "pending" })).length > 0
    );
  }

  public async wait(key: string, signal?: AbortSignal) {
    const deadline = Date.now() + 40_000;

    while (true) {
      signal?.throwIfAborted();
      const [delivery] = await this.#db.get("deliveries", { key });

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
    return this.#db.get(
      "deliveries",
      { noteId },
      {
        fields: ["id", "kind", "state", "createdAt"],
        sort: { id: "desc" },
        limit: 5,
      },
    );
  }

  public async next(kind: Delivery["kind"]): Promise<Delivery | null> {
    return this.#db.transact(async (db) => {
      const [delivery] = await db.get(
        "deliveries",
        { state: "pending", kind },
        { sort: { id: "asc" }, limit: 1 },
      );

      return delivery ?? null;
    });
  }

  public async done(id: number): Promise<void> {
    await this.#db.transact((db) =>
      db.set("deliveries", { id }, { state: "done" }),
    );
  }

  public async fail(id: number): Promise<void> {
    await this.#db.transact((db) =>
      db.set("deliveries", { id }, { state: "failed" }),
    );
  }

  public async retryFailed(groupId: string): Promise<number> {
    const result = await this.#db.transact((db) =>
      db.set("deliveries", { groupId, state: "failed" }, { state: "pending" }),
    );

    return result.matched!;
  }
}
