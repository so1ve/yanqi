import type { Context } from "@koishijs/core";

import type {
  Asset,
  Delivery,
  JobKind,
  JobPayloads,
  Message,
  Note,
  Segment,
  Topic,
} from "../types.ts";
import { decodeContent, encodeContent } from "./message-content.ts";

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
  progress: string | null;
}

interface MemoryRow {
  groupId: string;
  userId: string;
  key: string;
  content: string;
  sourceMessageId: number | null;
  updatedAt: number;
}

declare module "@koishijs/core" {
  interface Tables {
    groups: GroupRow;
    // 旧字段只供 Minato 首次转换已有数据库，转换后由驱动移除。
    messages: Message & { segments?: Segment[]; rawJson?: string };
    topics: Topic;
    topic_messages: { topicId: string; messageId: number; generation: number };
    assets: Asset;
    notes: Note & { createdAt: number };
    jobs: JobRow;
    deliveries: Delivery & {
      key: string;
      state: "pending" | "done" | "failed" | "cancelled";
      createdAt: number;
    };
    usage: {
      id: number;
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
    memories: MemoryRow;
  }
}

export type Database = Context["model"];

export function defineModels(model: Database): void {
  const messageContent = model.define<Segment[]>({
    type: "binary",
    dump: (value: Segment[] | null) =>
      value === null ? null : encodeContent(value),
    load: (value: ArrayBuffer | null) =>
      value === null ? null : decodeContent(value),
    initial: [],
  });

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
      content: messageContent,
      replyTo: { type: "string", nullable: true },
      isBot: { type: "boolean", initial: false },
      addressed: { type: "boolean", initial: false },
      role: "string",
      command: { type: "boolean", initial: false },
      awaitingReply: { type: "boolean", initial: false },
      recalledAt: { type: "integer", nullable: true },
      noteId: { type: "integer", nullable: true },
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

  model.migrate(
    "messages",
    { segments: "json", rawJson: "text" },
    async (db) => {
      let after = 0;

      while (true) {
        const messages = await db.get(
          "messages",
          { id: { $gt: after } },
          {
            fields: ["id", "segments"],
            sort: { id: "asc" },
            limit: 500,
          },
        );

        if (messages.length === 0) {
          break;
        }

        await db.upsert(
          "messages",
          messages.map(({ id, segments }) => ({
            id,
            content: segments!,
          })),
        );
        after = messages.at(-1)!.id;
      }
    },
  );

  model.extend(
    "topics",
    {
      id: "string",
      groupId: { type: "string" },
      title: "text",
      description: { type: "text", initial: "" },
      focus: { type: "text", initial: "" },
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
      endedAtMessageId: { type: "integer", nullable: true },
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
      generation: { type: "integer", initial: 0 },
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
      indexes: ["path"],
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
      sections: { type: "json", initial: [] },
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
      progress: { type: "text", nullable: true },
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
      provider: { type: "text", initial: "" },
      account: { type: "string", initial: "" },
      groupId: { type: "string", nullable: true },
      task: { type: "string", nullable: true },
      input: { type: "integer", nullable: true },
      output: { type: "integer", nullable: true },
      cacheRead: { type: "integer", nullable: true },
      cacheWrite: { type: "integer", nullable: true },
      durationMs: { type: "integer", nullable: true },
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
      sourceMessageId: { type: "integer", nullable: true },
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
