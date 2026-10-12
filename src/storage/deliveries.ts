import { Logger } from "koishi";

import type { Delivery, Note } from "../types.ts";
import type { Database } from "./schema.ts";

type Outgoing =
  | { kind: "text"; groupId: string; content: string }
  | { kind: "note"; note: Note; repeat?: boolean }
  | { kind: "saved"; note: Note; title: string };

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

      if (!existing) {
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
                ? `「${outgoing.title}」第 ${outgoing.note.revision} 版已保存。`
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
      } else {
        this.#logger.debug(
          "忽略重复发送：key=%s existing=%s",
          key,
          existing.id,
        );
        return false;
      }
    });
  }

  public async isPending(id: number): Promise<boolean> {
    return (
      (await this.#db.get("deliveries", { id, state: "pending" })).length > 0
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
