import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { Tables } from "koishi";
import { $ } from "koishi";

import { Memories } from "../agent/memory.ts";
import type { Asset, IncomingMessage, Message, Note, Topic } from "../types.ts";
import { beijingTime } from "../utils/time.ts";
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
    return this.#db.transact(async (db) => {
      const [existing] = await db.get("messages", {
        groupId: input.groupId,
        messageId: input.messageId,
      });

      if (existing) {
        if (input.noteId !== undefined) {
          await db.set(
            "messages",
            { id: existing.id },
            { noteId: input.noteId },
          );
        }

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

      const waiting = input.isBot
        ? []
        : await db.get("messages", {
            groupId: input.groupId,
            userId: input.userId,
            awaitingReply: true,
            recalledAt: { $exists: false },
          });
      const quote = input.replyTo
        ? await db.get("messages", {
            groupId: input.groupId,
            messageId: input.replyTo,
            isBot: true,
          })
        : [];
      const command =
        !input.isBot &&
        (input.addressed || waiting.length > 0 || quote.length > 0);

      if (waiting.length > 0) {
        await db.set(
          "messages",
          { id: waiting.map((item) => item.id) },
          { awaitingReply: false },
        );
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

  public async awaitReply(request: Message): Promise<void> {
    await this.#db.transact(async (db) => {
      const [next] = await db.get(
        "messages",
        {
          groupId: request.groupId,
          userId: request.userId,
          id: { $gt: request.id },
          recalledAt: { $exists: false },
        },
        { sort: { id: "asc" }, limit: 1 },
      );

      if (next) {
        await db.set("messages", { id: next.id }, { command: true });
        await enqueueJob(db, "intent", `intent:${next.id}`, {
          groupId: next.groupId,
          messageId: next.id,
        });
      } else {
        await db.set("messages", { id: request.id }, { awaitingReply: true });
      }
    });
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
      await this.#messageChanged(db, message.id);
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

  public history(
    groupId: string,
    through: number,
    from = 0,
    to = Number.MAX_SAFE_INTEGER,
  ): Promise<Message[]> {
    return this.#db.get(
      "messages",
      {
        groupId,
        sentAt: { $gte: from, $lt: to },
        id: { $lte: through },
        isBot: false,
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
      { groupId, id: { $gt: group.cursor }, isBot: false },
      { sort: { id: "asc" }, limit },
    );
  }

  public async requestReplies(
    groupId: string,
    messageIds: number[],
  ): Promise<void> {
    if (messageIds.length === 0) {
      return;
    }

    await this.#db.transact(async (db) => {
      const messages = await db.get("messages", {
        groupId,
        id: messageIds,
        isBot: false,
        command: false,
        recalledAt: { $exists: false },
      });

      for (const message of messages) {
        await db.set("messages", { id: message.id }, { command: true });
        await enqueueJob(db, "intent", `intent:${message.id}`, {
          groupId,
          messageId: message.id,
        });
      }
    });
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

  public createRecording(
    request: Message,
    options: {
      title: string;
      focus?: string;
      directive: Topic["directive"];
      messages: number[] | "following";
    },
  ): Promise<Topic> {
    return this.#db.transact(async (db) => {
      const continuous = options.messages === "following";
      const messages =
        options.messages === "following"
          ? (
              await db.get(
                "messages",
                {
                  groupId: request.groupId,
                  id: { $gt: request.id },
                  isBot: false,
                  command: false,
                },
                ["id"],
              )
            ).map((message) => message.id)
          : options.messages;
      const topic = await db.create("topics", {
        id: randomUUID(),
        groupId: request.groupId,
        title: options.title,
        focus: options.focus ?? "",
        mode: "manual",
        ownerId: request.userId,
        state: continuous ? "active" : "closed",
        lastActiveAt: request.receivedAt,
        directive: options.directive,
        directiveMessageId: request.id,
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

      await db.create("topic_messages", {
        topicId,
        messageId: id,
        generation: topic.generation + added + 1,
      });
      topic.lastSourceId = Math.max(topic.lastSourceId, id);
      topic.lastActiveAt = Math.max(topic.lastActiveAt, source.sentAt);
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
            lastActiveAt: 0,
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

  public async changedTopicMessages(
    topicId: string,
    since: number,
  ): Promise<Set<number>> {
    const links = await this.#db.get(
      "topic_messages",
      { topicId, generation: { $gt: since } },
      ["messageId"],
    );

    return new Set(links.map((link) => link.messageId));
  }

  async #messageChanged(db: Database, messageId: number): Promise<void> {
    const links = await db.get("topic_messages", { messageId });

    for (const { topicId } of links) {
      const [topic] = await db.get("topics", { id: topicId });

      assert.ok(topic);
      const generation = topic.generation + 1;

      await db.set("topic_messages", { topicId, messageId }, { generation });
      await db.set("topics", { id: topicId }, { generation });
    }
  }

  public stopRecording(
    topicId: string,
    through: number,
    include: number[],
    directive?: Topic["directive"],
  ): Promise<Topic> {
    return this.#db.transact(async (db) => {
      const [existing] = await db.get("topics", { id: topicId });

      assert.ok(existing);
      const endedAtMessageId = existing.endedAtMessageId ?? through;

      if (include.length > 0) {
        await this.#link(
          db,
          topicId,
          include.filter((id) => id < endedAtMessageId),
        );
      }

      const [topic] = await db.get("topics", { id: topicId });

      assert.ok(topic);
      const removed = await db.remove("topic_messages", {
        topicId,
        messageId: { $gte: endedAtMessageId },
      });

      if (removed.removed) {
        const links = await db.get("topic_messages", { topicId }, [
          "messageId",
        ]);

        topic.lastSourceId = links.reduce(
          (latest, link) => Math.max(latest, link.messageId),
          0,
        );
        topic.generation++;
      }

      topic.state = "closed";
      topic.endedAtMessageId = endedAtMessageId;
      if (directive !== undefined) {
        topic.directive = directive;
        topic.directiveMessageId = through;
      }

      await db.set(
        "topics",
        { id: topicId },
        {
          state: topic.state,
          lastSourceId: topic.lastSourceId,
          generation: topic.generation,
          endedAtMessageId,
          directive: topic.directive,
          directiveMessageId: topic.directiveMessageId,
        },
      );

      if (topic.lastSourceId && topic.generation !== topic.noteGeneration) {
        await enqueueJob(
          db,
          "summarize",
          `summarize:${topic.id}:${topic.generation}`,
          {
            groupId: topic.groupId,
            topicId: topic.id,
            requested: true,
          },
        );
      }

      return topic;
    });
  }

  public async lastStoppedRecording(
    groupId: string,
    ownerId: string,
  ): Promise<Topic | null> {
    const [topic] = await this.#db.get(
      "topics",
      {
        groupId,
        ownerId,
        mode: "manual",
        state: "closed",
        endedAtMessageId: { $exists: true },
      },
      { sort: { endedAtMessageId: "desc" }, limit: 1 },
    );

    return topic ?? null;
  }

  public reviseRecording(
    topicId: string,
    changes: { messageIds?: number[]; focus?: string },
  ): Promise<Topic> {
    return this.#db.transact(async (db) => {
      const [topic] = await db.get("topics", { id: topicId });

      assert.ok(topic);
      if (changes.messageIds !== undefined) {
        await db.remove("topic_messages", { topicId });
        await db.set("topics", { id: topicId }, { lastSourceId: 0 });
        await this.#link(db, topicId, changes.messageIds);
      }

      if (changes.focus !== undefined && changes.focus !== topic.focus) {
        const [current] = await db.get("topics", { id: topicId });
        const generation = current!.generation + 1;

        await db.set(
          "topics",
          { id: topicId },
          { focus: changes.focus, generation },
        );
        // 选材要求改变后，旧段落不能继续复用。
        await db.set("topic_messages", { topicId }, { generation });
      }

      const [updated] = await db.get("topics", { id: topicId });

      return updated!;
    });
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
      await this.#messageChanged(db, asset.messageId);
    });
  }

  public saveNote(
    topicId: string,
    sourceThrough: number,
    generation: number,
    markdown: string,
    sections: Note["sections"],
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
        sections,
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
        $or: [
          { id: literal },
          { title: literal },
          { description: literal },
          { id: notes.map((note) => note.topicId) },
        ],
      },
      { sort: { lastActiveAt: "desc" }, limit: 10 },
    );
  }

  public searchMessages(
    groupId: string,
    query: string,
    through: number,
  ): Promise<Message[]> {
    const literal = new RegExp(
      query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );

    return this.#db.get(
      "messages",
      {
        groupId,
        id: { $lte: through },
        isBot: false,
        text: literal,
      },
      { sort: { id: "desc" }, limit: 8 },
    );
  }

  public reserveCall(
    day: string,
    model: string,
    purpose: string,
    limit: number,
    now: number,
    details: Pick<Tables["usage"], "provider" | "account" | "groupId" | "task">,
  ): Promise<number | null> {
    return this.#db.transact(async (db) => {
      const calls = await db.eval("usage", (row) => $.count(row.id), { day });

      if (calls >= limit) {
        return null;
      }

      const call = await db.create("usage", {
        createdAt: now,
        day,
        model,
        purpose,
        ...details,
      });

      return call.id;
    });
  }

  public async recordUsage(
    calls: Pick<
      Tables["usage"],
      "id" | "input" | "output" | "cacheRead" | "cacheWrite" | "durationMs"
    >[],
  ): Promise<void> {
    if (calls.length > 0) {
      await this.#db.transact((db) => db.upsert("usage", calls));
    }
  }

  public async usage(groupId: string, day: string): Promise<string> {
    const calls = await this.#db.get("usage", { groupId, day });
    const totals = new Map<
      string,
      {
        provider: string;
        account: string;
        model: string;
        purpose: string;
        calls: number;
        measuredCalls: number;
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      }
    >();

    for (const call of calls) {
      const key = JSON.stringify([
        call.provider,
        call.account,
        call.model,
        call.purpose,
      ]);
      const total = totals.get(key) ?? {
        provider: call.provider,
        account: call.account,
        model: call.model,
        purpose: call.purpose,
        calls: 0,
        measuredCalls: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      };

      total.calls++;
      if (call.input !== null) {
        total.measuredCalls++;
        total.input += call.input;
        total.output += call.output ?? 0;
        total.cacheRead += call.cacheRead ?? 0;
        total.cacheWrite += call.cacheWrite ?? 0;
      }

      totals.set(key, total);
    }

    return JSON.stringify({
      day,
      calls: calls.length,
      models: [...totals.values()],
      note: "token 合计仅包含有用量数据的调用；实际费用以提供商账单为准。account 是配置项名称，不含 key。",
    });
  }

  public async taskStatus(groupId: string, id: number) {
    const job = await this.jobs.get(groupId, id);
    const { payload } = job;
    const asset =
      "assetId" in payload ? await this.asset(payload.assetId) : null;
    const topic =
      "topicId" in payload ? await this.topic(payload.topicId) : null;
    const note = topic ? await this.latestNote(topic.id) : null;

    return {
      id: job.id,
      kind: job.kind,
      description: asset
        ? `消息 m${asset.messageId} 的${asset.kind}附件 #${asset.id}`
        : topic
          ? `整理「${topic.title}」`
          : job.kind === "detect"
            ? "自动识别群里的讨论话题"
            : "处理群成员的对话请求",
      state: job.state,
      attempts: job.attempts,
      progress: job.progress,
      error: job.lastError,
      retryAt:
        job.state === "pending" && job.lastError
          ? beijingTime(job.runAfter)
          : null,
      source: payload,
      result: asset
        ? {
            assetId: asset.id,
            messageId: `m${asset.messageId}`,
            fileSaved: asset.path !== null,
            interpretation: asset.interpretation,
            error: asset.error,
            note:
              job.state === "done" && !asset.interpretation
                ? "文件已保存，但没有内容识别结果；图片或语音需配置对应模型才能解析。"
                : null,
          }
        : note
          ? { noteId: note.id, revision: note.revision, path: note.path }
          : null,
    };
  }

  public async status(groupId: string): Promise<string> {
    const messages = await this.#db.eval("messages", (row) => $.count(row.id), {
      groupId,
      isBot: false,
    });
    const notes = await this.#db.eval("notes", (row) => $.count(row.id), {
      groupId,
    });
    const documents = await this.#db.eval("topics", (row) => $.count(row.id), {
      groupId,
      revision: { $gt: 0 },
    });
    const failed = await this.#db.eval("jobs", (row) => $.count(row.id), {
      "kind": { $ne: "intent" },
      "state": "failed",
      "payload.groupId": groupId,
    });
    const pending = await this.#db.eval("jobs", (row) => $.count(row.id), {
      "$or": [{ state: "pending" }, { state: "running" }],
      "payload.groupId": groupId,
    });
    const failedDeliveries = await this.#db.eval(
      "deliveries",
      (row) => $.count(row.id),
      {
        groupId,
        state: "failed",
      },
    );
    const pendingDeliveries = await this.#db.eval(
      "deliveries",
      (row) => $.count(row.id),
      {
        groupId,
        state: "pending",
      },
    );

    const tasks = await this.jobs.forGroup(groupId);

    return JSON.stringify({
      messages,
      documents,
      versions: notes,
      automatic: await this.aiEnabled(groupId),
      pendingTasks: pending,
      failedTasks: failed,
      pendingDeliveries,
      failedDeliveries,
      tasks: await Promise.all(
        tasks.map((task) => this.taskStatus(groupId, task.id)),
      ),
      note: "任务列表最多展示最近 20 个未完成任务。只能依据具体任务判断失败对象；不能把话题识别失败当作图片识别失败。",
    });
  }
}
