import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Memories } from "../agent/memory.ts";
import { $ } from "../koishi.cts";
import type { Asset, IncomingMessage, Message, Note, Topic } from "../types.ts";
import { DeliveryQueue } from "./deliveries.ts";
import { JobQueue, enqueueJob } from "./jobs.ts";
import type { Database } from "./schema.ts";

export class Store {
  #db: Database;
  public readonly directory: string;
  public readonly jobs: JobQueue;
  public readonly deliveries: DeliveryQueue;
  public readonly memories: Memories;

  constructor(db: Database, directory: string) {
    this.#db = db;
    this.directory = directory;
    this.jobs = new JobQueue(db);
    this.deliveries = new DeliveryQueue(db);
    this.memories = new Memories(db);
  }

  public async initialize(groups: string[]): Promise<void> {
    await this.#db.upsert(
      "groups",
      groups.map((id) => ({ id })),
    );
    await this.#db.set("jobs", { state: "running" }, (row) => ({
      state: $.if($.eq(row.kind, "intent"), "failed", "pending"),
    }));
  }

  public capture(input: IncomingMessage): Promise<Message | null> {
    const command = input.addressed && !input.isBot;

    return this.#db.transact(async (db) => {
      const [existing] = await db.get("messages", {
        groupId: input.groupId,
        messageId: input.messageId,
      });

      if (existing) {
        if (
          input.isBot &&
          JSON.parse(existing.rawJson).source === "yanqi-send" &&
          (input.raw as { source?: string }).source !== "yanqi-send"
        ) {
          await db.set(
            "messages",
            { id: existing.id },
            { rawJson: JSON.stringify(input.raw), segments: input.segments },
          );
        }

        return null;
      }

      const { raw, ...fields } = input;
      const message = await db.create("messages", {
        ...fields,
        rawJson: JSON.stringify(raw),
        command,
      });

      if (!input.isBot) {
        for (const segment of input.segments) {
          const kind = segment.type === "record" ? "audio" : segment.type;

          if (
            kind !== "audio" &&
            kind !== "file" &&
            kind !== "forward" &&
            kind !== "image" &&
            kind !== "video"
          ) {
            continue;
          }

          const reference = String(
            segment.data.url ||
              segment.data.id ||
              segment.data.file_id ||
              segment.data.file ||
              "",
          );

          if (!reference) {
            continue;
          }

          const [existingAsset] = await db.get("assets", {
            messageId: message.id,
            kind,
            reference,
          });

          if (existingAsset) {
            continue;
          }

          const asset = await db.create("assets", {
            messageId: message.id,
            kind,
            reference,
          });

          await enqueueJob(db, "asset", `asset:${asset.id}`, {
            assetId: asset.id,
            groupId: input.groupId,
          });
        }

        if (command) {
          await enqueueJob(db, "intent", `intent:${message.id}`, {
            groupId: input.groupId,
            messageId: message.id,
          });
        } else {
          const topics = await db.get("topics", {
            groupId: input.groupId,
            mode: "manual",
            state: "active",
          });

          for (const topic of topics) {
            await this.#link(db, topic.id, [message.id]);
          }
        }
      }

      return message;
    });
  }

  public async message(id: number): Promise<Message> {
    const [message] = await this.#db.get("messages", { id });

    if (!message) {
      throw new Error(`不存在的消息 m${id}`);
    }

    return message;
  }

  public async quoted(
    groupId: string,
    messageId: string,
  ): Promise<Message | null> {
    const [message] = await this.#db.get("messages", { groupId, messageId });

    return message ?? null;
  }

  public async recall(
    groupId: string,
    messageId: string,
    now: number,
  ): Promise<void> {
    await this.#db.transact(async (db) => {
      const [message] = await db.get("messages", { groupId, messageId });

      if (message?.recalledAt !== null) {
        return;
      }

      await db.set("messages", { id: message.id }, { recalledAt: now });
      await db.remove("memories", { sourceMessageId: message.id });
      const links = await db.get("topic_messages", { messageId: message.id });

      await db.set(
        "topics",
        { id: links.map((link) => link.topicId) },
        (row) => ({ generation: $.add(row.generation, 1) }),
      );
    });
  }

  public async recent(
    groupId: string,
    limit: number,
    through = Number.MAX_SAFE_INTEGER,
  ): Promise<Message[]> {
    const messages = await this.#db.get(
      "messages",
      { groupId, id: { $lte: through }, isBot: false },
      { sort: { id: "desc" }, limit },
    );

    return messages.reverse();
  }

  public async conversation(
    groupId: string,
    limit: number,
    through: number,
  ): Promise<Message[]> {
    const messages = await this.#db.get(
      "messages",
      { groupId, id: { $lte: through } },
      { sort: { id: "desc" }, limit },
    );

    return messages.reverse();
  }

  public window(
    groupId: string,
    since: number,
    through: number,
  ): Promise<Message[]> {
    return this.#db.get(
      "messages",
      {
        groupId,
        sentAt: { $gte: since },
        id: { $lte: through },
        isBot: false,
        command: false,
      },
      { sort: { id: "asc" } },
    );
  }

  public async nextDetection(
    groupId: string,
    limit: number,
  ): Promise<Message[]> {
    const [group] = await this.#db.get("groups", { id: groupId });

    assert.ok(group);

    return this.#db.get(
      "messages",
      { groupId, id: { $gt: group.cursor }, isBot: false, command: false },
      { sort: { id: "asc" }, limit },
    );
  }

  public async setAI(groupId: string, enabled: boolean): Promise<void> {
    await this.#db.transact((db) =>
      db.set("groups", { id: groupId }, { aiEnabled: enabled }),
    );
  }

  public async aiEnabled(groupId: string): Promise<boolean> {
    const [group] = await this.#db.get("groups", { id: groupId });

    assert.ok(group);

    return group.aiEnabled;
  }

  public async topic(id: string): Promise<Topic> {
    const [topic] = await this.#db.get("topics", { id });

    if (!topic) {
      throw new Error(`不存在的话题 ${id}`);
    }

    return topic;
  }

  public topics(groupId: string, limit = 10): Promise<Topic[]> {
    return this.#db.get(
      "topics",
      { groupId },
      { sort: { lastActiveAt: "desc" }, limit },
    );
  }

  public automaticTopics(groupId: string, since: number): Promise<Topic[]> {
    return this.#db.get(
      "topics",
      { groupId, mode: "auto", lastActiveAt: { $gte: since } },
      { sort: { lastActiveAt: "desc" } },
    );
  }

  public manualTopics(groupId: string, ownerId?: string): Promise<Topic[]> {
    return this.#db.get("topics", {
      groupId,
      mode: "manual",
      state: "active",
      ...(ownerId === undefined ? {} : { ownerId }),
    });
  }

  public createTopic(
    groupId: string,
    title: string,
    mode: Topic["mode"],
    ownerId: string | null,
    messages: number[],
    now: number,
    directive: Topic["directive"] = "auto",
    directiveMessageId: number | null = null,
  ): Promise<Topic> {
    return this.#db.transact(async (db) => {
      const topic = await db.create("topics", {
        id: randomUUID(),
        groupId,
        title,
        mode,
        ownerId,
        lastActiveAt: now,
        directive,
        directiveMessageId,
      });

      await this.#link(db, topic.id, messages);
      const [linked] = await db.get("topics", { id: topic.id });

      assert.ok(linked);

      return linked;
    });
  }

  async #link(db: Database, topicId: string, ids: number[]): Promise<void> {
    const [topic] = await db.get("topics", { id: topicId });

    assert.ok(topic);
    const messages = await db.get("messages", { id: ids });
    const links = await db.get("topic_messages", { topicId, messageId: ids });
    const existing = new Set(links.map((link) => link.messageId));
    let added = 0;

    for (const id of new Set(ids)) {
      const source = messages.find((message) => message.id === id);

      assert.ok(source, `不存在的消息 m${id}`);
      if (source.groupId !== topic.groupId) {
        throw new Error("话题不能关联其他群的消息");
      }

      if (existing.has(id)) {
        continue;
      }

      await db.create("topic_messages", { topicId, messageId: id });
      topic.lastSourceId = Math.max(topic.lastSourceId, id);
      topic.lastActiveAt = Math.max(topic.lastActiveAt, source.receivedAt);
      added++;
    }

    if (added) {
      await db.set(
        "topics",
        { id: topicId },
        {
          generation: topic.generation + added,
          lastSourceId: topic.lastSourceId,
          lastActiveAt: topic.lastActiveAt,
          state: "active",
        },
      );
    }
  }

  public async commitDetection(
    groupId: string,
    through: number,
    assignments: {
      id: string;
      title: string;
      description: string;
      messageIds: number[];
    }[],
    now: number,
  ): Promise<void> {
    await this.#db.transact(async (db) => {
      for (const assignment of assignments) {
        const id = assignment.id.startsWith("new:")
          ? randomUUID()
          : assignment.id;

        if (assignment.id.startsWith("new:")) {
          await db.create("topics", {
            id,
            groupId,
            title: assignment.title,
            mode: "auto",
            ownerId: null,
            lastActiveAt: now,
          });
        } else {
          const [topic] = await db.get("topics", { id });

          assert.ok(topic);
          if (topic.groupId !== groupId) {
            throw new Error("话题属于其他群");
          }
        }

        await this.#link(db, id, assignment.messageIds);
        await db.set(
          "topics",
          { id },
          { title: assignment.title, description: assignment.description },
        );
      }

      await db.set("groups", { id: groupId }, (row) => ({
        cursor: $.max([row.cursor, through]),
      }));
    });
  }

  public async topicMessages(
    topicId: string,
    through = Number.MAX_SAFE_INTEGER,
  ): Promise<Message[]> {
    const links = await this.#db.get("topic_messages", { topicId });

    return this.#db.get(
      "messages",
      { id: { $in: links.map((link) => link.messageId), $lte: through } },
      { sort: { id: "asc" } },
    );
  }

  public async closeTopic(topicId: string): Promise<void> {
    await this.#db.transact((db) =>
      db.set("topics", { id: topicId }, { state: "closed" }),
    );
  }

  public async setDirective(
    topicId: string,
    directive: Topic["directive"],
    messageId: number,
  ): Promise<void> {
    await this.#db.transact((db) =>
      db.set(
        "topics",
        { id: topicId },
        { directive, directiveMessageId: messageId },
      ),
    );
  }

  public async readyTopics(now: number, idle: number): Promise<Topic[]> {
    const groups = await this.#db.get("groups", { aiEnabled: true }, ["id"]);

    return this.#db
      .select("topics", {
        lastSourceId: { $gt: 0 },
        $or: [
          {
            groupId: groups.map((group) => group.id),
            mode: "auto",
            lastActiveAt: { $lte: now - idle },
          },
          { mode: "manual", state: "closed" },
        ],
      })
      .where((row) => $.ne(row.generation, row.noteGeneration))
      .execute();
  }

  public async asset(id: number): Promise<Asset> {
    const [asset] = await this.#db.get("assets", { id });

    if (!asset) {
      throw new Error(`不存在的附件 ${id}`);
    }

    return asset;
  }

  public assets(messageId: number): Promise<Asset[]> {
    return this.#db.get("assets", { messageId }, { sort: { id: "asc" } });
  }

  public async saveAsset(
    id: number,
    state: Asset["state"],
    path: string | null,
    interpretation: string | null,
    error: string | null,
  ): Promise<void> {
    await this.#db.transact(async (db) => {
      const [asset] = await db.get("assets", { id });

      assert.ok(asset);
      if (
        asset.state === state &&
        asset.path === path &&
        asset.interpretation === interpretation &&
        asset.error === error
      ) {
        return;
      }

      await db.set("assets", { id }, { state, path, interpretation, error });
      const links = await db.get("topic_messages", {
        messageId: asset.messageId,
      });

      await db.set(
        "topics",
        { id: links.map((link) => link.topicId) },
        (row) => ({ generation: $.add(row.generation, 1) }),
      );
    });
  }

  public saveNote(
    topicId: string,
    sourceThrough: number,
    generation: number,
    markdown: string,
    path: string,
    now: number,
  ): Promise<Note> {
    return this.#db.transact(async (db) => {
      const [topic] = await db.get("topics", { id: topicId });

      assert.ok(topic);
      const revision = topic.revision + 1;
      const note = await db.create("notes", {
        topicId,
        groupId: topic.groupId,
        revision,
        sourceThrough,
        generation,
        markdown,
        path,
        createdAt: now,
      });

      await db.set(
        "topics",
        { id: topicId },
        { revision, noteGeneration: generation },
      );

      return note;
    });
  }

  public async note(id: number): Promise<Note> {
    const [note] = await this.#db.get("notes", { id });

    if (!note) {
      throw new Error(`不存在的纪要 ${id}`);
    }

    return note;
  }

  public async latestNote(topicId: string): Promise<Note | null> {
    const [note] = await this.#db.get(
      "notes",
      { topicId },
      { sort: { revision: "desc" }, limit: 1 },
    );

    return note ?? null;
  }

  public async search(groupId: string, query: string): Promise<Topic[]> {
    const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const notes = await this.#db.get("notes", { groupId, markdown: literal }, [
      "topicId",
    ]);

    return this.#db.get(
      "topics",
      {
        groupId,
        $or: [{ title: literal }, { id: notes.map((note) => note.topicId) }],
      },
      { sort: { lastActiveAt: "desc" }, limit: 10 },
    );
  }

  public reserveCall(
    day: string,
    model: string,
    purpose: string,
    limit: number,
    now: number,
  ): Promise<boolean> {
    return this.#db.transact(async (db) => {
      const calls = await db.eval("usage", (row) => $.count(row.id), { day });

      if (calls >= limit) {
        return false;
      }

      await db.create("usage", { createdAt: now, day, model, purpose });

      return true;
    });
  }

  public async status(groupId: string): Promise<string> {
    const messages = await this.#db.eval("messages", (row) => $.count(row.id), {
      groupId,
    });
    const notes = await this.#db.eval("notes", (row) => $.count(row.id), {
      groupId,
    });
    const failed = await this.#db.eval("jobs", (row) => $.count(row.id), {
      "state": "failed",
      "payload.groupId": groupId,
    });
    const pending = await this.#db.eval("jobs", (row) => $.count(row.id), {
      "$or": [{ state: "pending" }, { state: "running" }],
      "payload.groupId": groupId,
    });

    return `本群已保存 ${messages} 条消息、${notes} 版纪要。自动整理${(await this.aiEnabled(groupId)) ? "开启" : "关闭"}。\n待处理任务 ${pending}，需重试任务 ${failed}。`;
  }
}
