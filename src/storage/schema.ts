import type { Context } from "koishi";

import type {
  Asset,
  Delivery,
  JobKind,
  JobPayloads,
  Message,
  Note,
  Topic,
} from "../types.ts";

interface GroupRow {
  id: string;
  cursor: number;
  aiEnabled: boolean;
}

interface JobRow {
  id: number;
  kind: JobKind;
  payload: JobPayloads[JobKind];
  attempts: number;
  key: string;
  state: "pending" | "running" | "done" | "failed";
  runAfter: number;
  lastError: string | null;
}

interface MemoryRow {
  groupId: string;
  userId: string;
  key: string;
  content: string;
  sourceMessageId: number;
  updatedAt: number;
}

declare module "koishi" {
  interface Tables {
    groups: GroupRow;
    messages: Message;
    topics: Topic;
    topic_messages: { topicId: string; messageId: number };
    assets: Asset;
    notes: Note & { createdAt: number };
    jobs: JobRow;
    deliveries: Delivery & {
      key: string;
      state: "pending" | "done";
      createdAt: number;
    };
    usage: {
      id: number;
      createdAt: number;
      day: string;
      model: string;
      purpose: string;
    };
    memories: MemoryRow;
  }
}

export type Database = Context["model"];

export function defineModels(model: Database): void {
  model.extend(
    "groups",
    {
      id: "string",
      cursor: "integer",
      aiEnabled: { type: "boolean", initial: true },
    },
    { primary: "id" },
  );

  model.extend(
    "messages",
    {
      id: "unsigned",
      groupId: { type: "string" },
      messageId: { type: "string" },
      userId: { type: "string" },
      displayName: { type: "text" },
      sentAt: { type: "integer" },
      receivedAt: { type: "integer" },
      text: "text",
      segments: "json",
      rawJson: { type: "text" },
      replyTo: { type: "string", nullable: true },
      isBot: { type: "boolean", initial: false },
      addressed: { type: "boolean", initial: false },
      role: "string",
      command: { type: "boolean", initial: false },
      recalledAt: { type: "integer", nullable: true },
    },
    {
      autoInc: true,
      unique: [["groupId", "messageId"]],
      indexes: [
        ["groupId", "id"],
        ["groupId", "sentAt"],
      ],
      foreign: { groupId: ["groups", "id"] },
    },
  );

  model.extend(
    "topics",
    {
      id: "string",
      groupId: { type: "string" },
      title: "text",
      description: { type: "text", initial: "" },
      mode: "string",
      ownerId: { type: "string", nullable: true },
      state: { type: "string", initial: "active" },
      lastActiveAt: { type: "integer" },
      lastSourceId: { type: "integer", initial: 0 },
      revision: { type: "integer", initial: 0 },
      generation: { type: "integer", initial: 0 },
      noteGeneration: {
        type: "integer",
        initial: -1,
      },
      directive: { type: "string", initial: "auto" },
      directiveMessageId: {
        type: "integer",
        nullable: true,
      },
    },
    {
      primary: "id",
      indexes: [["groupId", "lastActiveAt"]],
      foreign: { groupId: ["groups", "id"] },
    },
  );

  model.extend(
    "topic_messages",
    {
      topicId: { type: "string" },
      messageId: { type: "integer" },
    },
    {
      primary: ["topicId", "messageId"],
      foreign: { topicId: ["topics", "id"], messageId: ["messages", "id"] },
    },
  );

  model.extend(
    "assets",
    {
      id: "unsigned",
      messageId: { type: "integer" },
      kind: "string",
      reference: "text",
      state: { type: "string", initial: "pending" },
      path: { type: "text", nullable: true },
      interpretation: { type: "text", nullable: true },
      error: { type: "text", nullable: true },
    },
    {
      autoInc: true,
      unique: [["messageId", "kind", "reference"]],
      foreign: { messageId: ["messages", "id"] },
    },
  );

  model.extend(
    "notes",
    {
      id: "unsigned",
      topicId: { type: "string" },
      groupId: { type: "string" },
      revision: "integer",
      sourceThrough: { type: "integer" },
      generation: "integer",
      markdown: "text",
      path: "text",
      createdAt: { type: "integer" },
    },
    {
      autoInc: true,
      unique: [["topicId", "generation"]],
      foreign: { topicId: ["topics", "id"] },
    },
  );

  model.extend(
    "jobs",
    {
      id: "unsigned",
      kind: "string",
      key: { type: "string" },
      payload: "json",
      state: { type: "string", initial: "pending" },
      attempts: { type: "integer", initial: 0 },
      runAfter: { type: "integer" },
      lastError: { type: "text", nullable: true },
    },
    { autoInc: true, unique: ["key"], indexes: [["state", "runAfter"]] },
  );

  model.extend(
    "deliveries",
    {
      id: "unsigned",
      key: { type: "string" },
      groupId: { type: "string" },
      topicId: { type: "string", nullable: true },
      noteId: { type: "integer", nullable: true },
      kind: "string",
      content: "text",
      state: { type: "string", initial: "pending" },
      createdAt: { type: "integer" },
    },
    { autoInc: true, unique: ["key"] },
  );

  model.extend(
    "usage",
    {
      id: "unsigned",
      createdAt: { type: "integer" },
      day: "string",
      model: "string",
      purpose: "string",
    },
    { autoInc: true },
  );

  model.extend(
    "memories",
    {
      groupId: { type: "string" },
      userId: { type: "string" },
      key: "string",
      content: "text",
      sourceMessageId: { type: "integer" },
      updatedAt: { type: "integer" },
    },
    {
      primary: ["groupId", "userId", "key"],
      indexes: ["sourceMessageId"],
      foreign: {
        groupId: ["groups", "id"],
        sourceMessageId: ["messages", "id"],
      },
    },
  );
}
