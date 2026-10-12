import { $ } from "koishi";

import { Assets } from "./assets.ts";
import { DeliveryQueue } from "./deliveries.ts";
import { Groups } from "./groups.ts";
import { JobQueue } from "./jobs.ts";
import { Memories } from "./memories.ts";
import { Messages } from "./messages.ts";
import { SavedNotes } from "./notes.ts";
import { Recordings } from "./recordings.ts";
import type { Database } from "./schema.ts";
import { Topics } from "./topics.ts";
import { Usage } from "./usage.ts";

export class Store {
  #db: Database;
  public readonly directory: string;
  public readonly messages: Messages;
  public readonly topics: Topics;
  public readonly recordings: Recordings;
  public readonly notes: SavedNotes;
  public readonly assets: Assets;
  public readonly usage: Usage;
  public readonly groups: Groups;
  public readonly jobs: JobQueue;
  public readonly deliveries: DeliveryQueue;
  public readonly memories: Memories;

  constructor(db: Database, directory: string) {
    this.#db = db;
    this.directory = directory;
    this.messages = new Messages(db);
    this.topics = new Topics(db);
    this.recordings = new Recordings(db);
    this.notes = new SavedNotes(db);
    this.assets = new Assets(db);
    this.usage = new Usage(db);
    this.groups = new Groups(db);
    this.jobs = new JobQueue(db);
    this.deliveries = new DeliveryQueue(db);
    this.memories = new Memories(db);
  }

  public async initialize(groups: string[]): Promise<void> {
    await this.#db.upsert(
      "groups",
      groups.map((id) => ({ id })),
    );
    // 重启后不再判断旧闲聊是否需要插话；新消息会带上近期上下文。
    await this.#db.set(
      "jobs",
      { kind: "observe", $or: [{ state: "pending" }, { state: "running" }] },
      {
        state: "failed",
        lastError: "服务重启，跳过旧消息的搭话判断",
      },
    );
    await this.#db.set("jobs", { state: "running" }, (row) => ({
      state: $.if($.eq(row.kind, "intent"), "failed", "pending"),
    }));
  }
}
