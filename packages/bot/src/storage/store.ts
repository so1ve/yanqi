import type { Config } from "../config.ts";
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

  constructor(db: Database, directory: string, config: Config) {
    this.directory = directory;
    this.messages = new Messages(db, config);
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
}
