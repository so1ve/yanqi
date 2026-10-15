import type { Generated, Kysely, Selectable } from "kysely";

import type {
  Asset,
  Delivery,
  JobKind,
  Memory,
  Message,
  Note,
  Topic,
} from "../types.ts";

type Defaults<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: Generated<T[P]>;
};

export interface Tables {
  groups: {
    id: string;
    cursor: Generated<number>;
    aiEnabled: Generated<number>;
    historyThrough: Generated<number>;
  };
  conversations: {
    groupId: string;
    id: string;
    afterMessageId: number;
    summary: string;
    messages: string;
  };
  messages: Defaults<
    Omit<
      Message,
      "content" | "isBot" | "addressed" | "command" | "historical"
    > & {
      content: Uint8Array;
      isBot: number;
      addressed: number;
      command: number;
      historical: number;
    },
    "id" | "isBot" | "addressed" | "command" | "historical"
  >;
  message_reactions: {
    messageId: number;
    emojiType: string;
    emojiId: string;
    userId: string;
    isBot: number;
  };
  topics: Defaults<
    Topic,
    | "description"
    | "focus"
    | "lastSourceId"
    | "revision"
    | "generation"
    | "noteGeneration"
    | "directive"
  >;
  topic_messages: {
    topicId: string;
    messageId: number;
    generation: Generated<number>;
  };
  assets: Defaults<Asset, "id" | "state">;
  notes: Defaults<
    Omit<Note, "sections"> & { sections: string; createdAt: number },
    "id" | "sections"
  >;
  jobs: {
    id: Generated<number>;
    kind: JobKind;
    payload: string;
    attempts: Generated<number>;
    key: string;
    state: Generated<"pending" | "running" | "done" | "failed">;
    runAfter: number;
    lastError: string | null;
    progress: string | null;
  };
  deliveries: Defaults<
    Delivery & {
      key: string;
      state: "pending" | "done" | "failed" | "cancelled";
      createdAt: number;
    },
    "id" | "state"
  >;
  usage: {
    id: Generated<number>;
    createdAt: number;
    day: string;
    model: string;
    purpose: string;
    provider: string;
    account: string;
    groupId: string | null;
    task: string | null;
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    durationMs: number | null;
  };
  memories: Memory;
}

export type Database = Kysely<Tables>;
export type MessageRow = Selectable<Tables["messages"]>;
export type JobRow = Selectable<Tables["jobs"]>;
export type NoteRow = Selectable<Tables["notes"]>;
export type UsageRow = Selectable<Tables["usage"]>;

export async function createTables(db: Database): Promise<void> {
  await db.schema
    .createTable("groups")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("cursor", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("historyThrough", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn("aiEnabled", "integer", (column) =>
      column.notNull().defaultTo(1),
    )
    .execute();

  await db.schema
    .createTable("conversations")
    .ifNotExists()
    .addColumn("groupId", "text", (column) =>
      column.primaryKey().references("groups.id"),
    )
    .addColumn("id", "text", (column) => column.notNull())
    .addColumn("afterMessageId", "integer", (column) => column.notNull())
    .addColumn("summary", "text", (column) => column.notNull())
    .addColumn("messages", "text", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("messages")
    .ifNotExists()
    .addColumn("id", "integer", (column) => column.primaryKey().autoIncrement())
    .addColumn("groupId", "text", (column) =>
      column.notNull().references("groups.id"),
    )
    .addColumn("messageId", "text", (column) => column.notNull())
    .addColumn("userId", "text", (column) => column.notNull())
    .addColumn("displayName", "text", (column) => column.notNull())
    .addColumn("sentAt", "integer", (column) => column.notNull())
    .addColumn("receivedAt", "integer", (column) => column.notNull())
    .addColumn("text", "text", (column) => column.notNull())
    .addColumn("content", "blob", (column) => column.notNull())
    .addColumn("replyTo", "text")
    .addColumn("isBot", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("addressed", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn("role", "text", (column) => column.notNull())
    .addColumn("command", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("historical", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn("recalledAt", "integer")
    .addColumn("noteId", "integer")
    .addUniqueConstraint("messages_group_message", ["groupId", "messageId"])
    .execute();

  await db.schema
    .createTable("message_reactions")
    .ifNotExists()
    .addColumn("messageId", "integer", (column) =>
      column.notNull().references("messages.id").onDelete("cascade"),
    )
    .addColumn("emojiType", "text", (column) => column.notNull())
    .addColumn("emojiId", "text", (column) => column.notNull())
    .addColumn("userId", "text", (column) => column.notNull())
    .addColumn("isBot", "integer", (column) => column.notNull())
    .addPrimaryKeyConstraint("message_reactions_primary", [
      "messageId",
      "emojiType",
      "emojiId",
      "userId",
    ])
    .execute();

  await db.schema
    .createTable("topics")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("groupId", "text", (column) =>
      column.notNull().references("groups.id"),
    )
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("description", "text", (column) =>
      column.notNull().defaultTo(""),
    )
    .addColumn("focus", "text", (column) => column.notNull().defaultTo(""))
    .addColumn("mode", "text", (column) => column.notNull())
    .addColumn("ownerId", "text")
    .addColumn("state", "text", (column) => column.notNull())
    .addColumn("lastActiveAt", "integer", (column) => column.notNull())
    .addColumn("lastSourceId", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn("revision", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("generation", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn("noteGeneration", "integer", (column) =>
      column.notNull().defaultTo(-1),
    )
    .addColumn("directive", "text", (column) =>
      column.notNull().defaultTo("auto"),
    )
    .addColumn("directiveMessageId", "integer")
    .addColumn("endedAtMessageId", "integer")
    .execute();

  await db.schema
    .createTable("topic_messages")
    .ifNotExists()
    .addColumn("topicId", "text", (column) =>
      column.notNull().references("topics.id"),
    )
    .addColumn("messageId", "integer", (column) =>
      column.notNull().references("messages.id"),
    )
    .addColumn("generation", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .addPrimaryKeyConstraint("topic_messages_primary", ["topicId", "messageId"])
    .execute();

  await db.schema
    .createTable("assets")
    .ifNotExists()
    .addColumn("id", "integer", (column) => column.primaryKey().autoIncrement())
    .addColumn("messageId", "integer", (column) =>
      column.notNull().references("messages.id"),
    )
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("reference", "text", (column) => column.notNull())
    .addColumn("state", "text", (column) =>
      column.notNull().defaultTo("pending"),
    )
    .addColumn("path", "text")
    .addColumn("interpretation", "text")
    .addColumn("error", "text")
    .addUniqueConstraint("assets_message_reference", [
      "messageId",
      "kind",
      "reference",
    ])
    .execute();

  await db.schema
    .createTable("notes")
    .ifNotExists()
    .addColumn("id", "integer", (column) => column.primaryKey().autoIncrement())
    .addColumn("topicId", "text", (column) =>
      column.notNull().references("topics.id"),
    )
    .addColumn("groupId", "text", (column) => column.notNull())
    .addColumn("revision", "integer", (column) => column.notNull())
    .addColumn("sourceThrough", "integer", (column) => column.notNull())
    .addColumn("generation", "integer", (column) => column.notNull())
    .addColumn("markdown", "text", (column) => column.notNull())
    .addColumn("sections", "text", (column) => column.notNull().defaultTo("[]"))
    .addColumn("path", "text", (column) => column.notNull())
    .addColumn("createdAt", "integer", (column) => column.notNull())
    .addUniqueConstraint("notes_topic_generation", ["topicId", "generation"])
    .execute();

  await db.schema
    .createTable("jobs")
    .ifNotExists()
    .addColumn("id", "integer", (column) => column.primaryKey().autoIncrement())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("key", "text", (column) => column.notNull().unique())
    .addColumn("payload", "text", (column) => column.notNull())
    .addColumn("state", "text", (column) =>
      column.notNull().defaultTo("pending"),
    )
    .addColumn("attempts", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("runAfter", "integer", (column) => column.notNull())
    .addColumn("lastError", "text")
    .addColumn("progress", "text")
    .execute();

  await db.schema
    .createTable("deliveries")
    .ifNotExists()
    .addColumn("id", "integer", (column) => column.primaryKey().autoIncrement())
    .addColumn("key", "text", (column) => column.notNull().unique())
    .addColumn("groupId", "text", (column) => column.notNull())
    .addColumn("topicId", "text")
    .addColumn("noteId", "integer")
    .addColumn("replyTo", "text")
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("content", "text", (column) => column.notNull())
    .addColumn("state", "text", (column) =>
      column.notNull().defaultTo("pending"),
    )
    .addColumn("createdAt", "integer", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("usage")
    .ifNotExists()
    .addColumn("id", "integer", (column) => column.primaryKey().autoIncrement())
    .addColumn("createdAt", "integer", (column) => column.notNull())
    .addColumn("day", "text", (column) => column.notNull())
    .addColumn("model", "text", (column) => column.notNull())
    .addColumn("purpose", "text", (column) => column.notNull())
    .addColumn("provider", "text", (column) => column.notNull())
    .addColumn("account", "text", (column) => column.notNull())
    .addColumn("groupId", "text")
    .addColumn("task", "text")
    .addColumn("input", "integer")
    .addColumn("output", "integer")
    .addColumn("cacheRead", "integer")
    .addColumn("cacheWrite", "integer")
    .addColumn("durationMs", "integer")
    .execute();

  await db.schema
    .createTable("memories")
    .ifNotExists()
    .addColumn("scope", "text", (column) => column.notNull())
    .addColumn("ownerId", "text", (column) => column.notNull())
    .addColumn("key", "text", (column) => column.notNull())
    .addColumn("summary", "text", (column) => column.notNull())
    .addColumn("content", "text", (column) => column.notNull())
    .addColumn("sourceMessageId", "integer", (column) =>
      column.references("messages.id"),
    )
    .addColumn("updatedAt", "integer", (column) => column.notNull())
    .addPrimaryKeyConstraint("memories_primary", ["scope", "ownerId", "key"])
    .execute();

  await db.schema
    .createIndex("index:messages:groupId+id")
    .ifNotExists()
    .on("messages")
    .columns(["groupId", "id"])
    .execute();
  await db.schema
    .createIndex("index:messages:groupId+sentAt")
    .ifNotExists()
    .on("messages")
    .columns(["groupId", "sentAt"])
    .execute();
  await db.schema
    .createIndex("index:topics:groupId+lastActiveAt")
    .ifNotExists()
    .on("topics")
    .columns(["groupId", "lastActiveAt"])
    .execute();
  await db.schema
    .createIndex("index:assets:path")
    .ifNotExists()
    .on("assets")
    .columns(["path"])
    .execute();
  await db.schema
    .createIndex("index:jobs:state+runAfter")
    .ifNotExists()
    .on("jobs")
    .columns(["state", "runAfter"])
    .execute();
  await db.schema
    .createIndex("index:memories:sourceMessageId")
    .ifNotExists()
    .on("memories")
    .columns(["sourceMessageId"])
    .execute();
}
