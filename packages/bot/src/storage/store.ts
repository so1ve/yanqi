import type { Config } from "../config.ts";
import { Assets } from "./assets.ts";
import { Conversations } from "./conversations.ts";
import { DeliveryQueue } from "./deliveries.ts";
import { Groups } from "./groups.ts";
import { Inbox } from "./inbox.ts";
import { JobQueue } from "./jobs.ts";
import { Memories } from "./memories.ts";
import { Messages } from "./messages.ts";
import { SavedNotes } from "./notes.ts";
import { overview } from "./overview.ts";
import { purgeHistory } from "./purge.ts";
import { Recordings } from "./recordings.ts";
import type { Database } from "./schema.ts";
import { Topics } from "./topics.ts";
import { Usage } from "./usage.ts";

export class Store {
  #db: Database;
  public readonly directory: string;
  public readonly messages: Messages;
  public readonly inbox: Inbox;
  public readonly conversations: Conversations;
  public readonly topics: Topics;
  public readonly recordings: Recordings;
  public readonly notes: SavedNotes;
  public readonly assets: Assets;
  public readonly usage: Usage;
  public readonly groups: Groups;
  public readonly jobs: JobQueue;
  public readonly deliveries: DeliveryQueue;
  public readonly memories: Memories;

  constructor(db: Database, directory: string, config: Config) {
    this.directory = directory;
    this.#db = db;
    this.messages = new Messages(db);
    this.inbox = new Inbox(db, config, this.messages);
    this.conversations = new Conversations(db);
    this.topics = new Topics(db, directory);
    this.recordings = new Recordings(db);
    this.notes = new SavedNotes(db, directory);
    this.assets = new Assets(db, directory);
    this.usage = new Usage(db);
    this.groups = new Groups(db);
    this.jobs = new JobQueue(db);
    this.deliveries = new DeliveryQueue(db);
    this.memories = new Memories(db);
  }

  public overview(day: string) {
    return overview(this.#db, day);
  }

  public purge(retentionDays: number) {
    return purgeHistory(this.#db, this.directory, retentionDays);
  }
}
