import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import type { Yanqi } from "@yanqi/bot";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { $ } from "koishi";
import { Type } from "typebox";

import { body, integer, pagination, requireItem, search } from "./http.ts";

export function registerRecords(app: Hono, bot: Yanqi): void {
  const db = bot.database;

  app.get("/api/groups/:groupId/records", async (ctx) => {
    const { page, limit, offset } = pagination(ctx);
    const pattern = search(ctx);
    const query = {
      groupId: ctx.req.param("groupId"),
      ...(pattern
        ? {
            $or: [
              { title: pattern },
              { description: pattern },
              { focus: pattern },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.get("topics", query, {
        sort: { lastActiveAt: "desc" },
        offset,
        limit,
      }),
      db.eval("topics", (row) => $.count(row.id), query),
    ]);

    return ctx.json({ items, total, page, limit });
  });

  app.post("/api/groups/:groupId/records", async (ctx) => {
    const groupId = ctx.req.param("groupId");

    requireItem((await db.get("groups", { id: groupId }))[0]);
    const input = await body(
      ctx,
      Type.Object({
        title: Type.String({ minLength: 1, maxLength: 300 }),
        focus: Type.String({ maxLength: 10_000, default: "" }),
        from: Type.Optional(Type.Integer({ minimum: 0 })),
        to: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
    );

    if (
      input.from !== undefined &&
      input.to !== undefined &&
      input.from > input.to
    ) {
      throw new HTTPException(400, { message: "开始时间不能晚于结束时间" });
    }

    const messages = await db.get(
      "messages",
      {
        groupId,
        isBot: false,
        command: false,
        sentAt: { $gte: input.from ?? 0, $lte: input.to ?? Date.now() },
      },
      { fields: ["id"], sort: { id: "asc" } },
    );

    if (messages.length === 0) {
      throw new HTTPException(400, { message: "这个范围内还没有保存的讨论" });
    }

    const topic = await bot.store.recordings.createForGroup(
      groupId,
      input.title,
      input.focus,
      messages.map((message) => message.id),
    );
    const taskId = await bot.store.jobs.enqueue(
      "summarize",
      `summarize:${topic.id}:${topic.generation}`,
      { groupId, topicId: topic.id, requested: true, publish: false },
    );

    bot.wake();

    return ctx.json({ topic, taskId }, 201);
  });

  app.get("/api/groups/:groupId/records/:topicId", async (ctx) => {
    const topic = requireItem(
      (
        await db.get("topics", {
          id: ctx.req.param("topicId"),
          groupId: ctx.req.param("groupId"),
        })
      )[0],
    );
    const versions = await db.get(
      "notes",
      { topicId: topic.id },
      {
        fields: ["id", "revision", "createdAt", "sourceThrough"],
        sort: { revision: "desc" },
      },
    );
    const id = ctx.req.query("version")
      ? integer(ctx.req.query("version"))
      : versions[0]?.id;
    const note =
      id === undefined
        ? null
        : requireItem((await db.get("notes", { id, topicId: topic.id }))[0]);
    const tasks = await bot.store.jobs.forTopic(topic.id);

    return ctx.json({ topic, note, versions, tasks });
  });

  app.get("/api/groups/:groupId/records/:topicId/transcript", async (ctx) => {
    const topic = requireItem(
      (
        await db.get("topics", {
          id: ctx.req.param("topicId"),
          groupId: ctx.req.param("groupId"),
        })
      )[0],
    );
    const note = ctx.req.query("version")
      ? requireItem(
          (
            await db.get("notes", {
              id: integer(ctx.req.query("version")),
              topicId: topic.id,
            })
          )[0],
        )
      : requireItem((await bot.store.notes.latest(topic.id)) ?? undefined);
    const path = resolve(dirname(note.path), "transcript.md");

    if (!path.startsWith(`${resolve(bot.config.DATA_DIR)}${sep}`)) {
      throw new HTTPException(400, { message: "原文不在当前数据目录中" });
    }

    return ctx.text(await readFile(path, "utf8"));
  });

  app.post("/api/groups/:groupId/records/:topicId/summarize", async (ctx) => {
    const topic = await db.transact(async (tx) => {
      const topic = requireItem(
        (
          await tx.get("topics", {
            id: ctx.req.param("topicId"),
            groupId: ctx.req.param("groupId"),
          })
        )[0],
      );
      const busy = await tx.get("jobs", {
        "kind": "summarize",
        "payload.topicId": topic.id,
        "$or": [{ state: "pending" }, { state: "running" }],
      });

      if (busy.length > 0) {
        throw new HTTPException(409, { message: "这篇纪要已经在整理队列中" });
      }

      const input = await body(
        ctx,
        Type.Object({ focus: Type.String({ maxLength: 10_000 }) }),
      );
      const generation = topic.generation + 1;

      await tx.set(
        "topics",
        { id: topic.id },
        { generation, focus: input.focus },
      );
      await tx.set("topic_messages", { topicId: topic.id }, { generation });

      return { ...topic, generation };
    });
    const taskId = await bot.store.jobs.enqueue(
      "summarize",
      `summarize:${topic.id}:${topic.generation}`,
      {
        groupId: topic.groupId,
        topicId: topic.id,
        requested: true,
        publish: false,
      },
    );

    bot.wake();

    return ctx.json({ taskId });
  });

  app.post("/api/groups/:groupId/records/:topicId/send", async (ctx) => {
    if (!bot.running || !bot.online) {
      throw new HTTPException(409, { message: "请先启动机器人并连接 NapCat" });
    }

    const topic = requireItem(
      (
        await db.get("topics", {
          id: ctx.req.param("topicId"),
          groupId: ctx.req.param("groupId"),
        })
      )[0],
    );
    const input = await body(
      ctx,
      Type.Object({ noteId: Type.Integer({ minimum: 1 }) }),
    );
    const note = requireItem(
      (await db.get("notes", { id: input.noteId, topicId: topic.id }))[0],
    );

    if (!bot.config.GROUP_IDS.includes(topic.groupId)) {
      throw new HTTPException(409, { message: "请先启用这个群" });
    }

    await db.set("topics", { id: topic.id }, { directive: "send" });
    const queued = await bot.store.deliveries.enqueue(
      `console:${randomUUID()}`,
      { kind: "note", note, repeat: true },
    );

    bot.wake();

    return ctx.json({ queued });
  });

  app.put("/api/groups/:groupId/records/:topicId/content", async (ctx) => {
    const input = await body(
      ctx,
      Type.Object({
        noteId: Type.Integer({ minimum: 1 }),
        markdown: Type.String({ minLength: 1, maxLength: 2_000_000 }),
      }),
    );
    const note = await db.transact(async (tx) => {
      const topic = requireItem(
        (
          await tx.get("topics", {
            id: ctx.req.param("topicId"),
            groupId: ctx.req.param("groupId"),
          })
        )[0],
      );
      const current = requireItem(
        (await tx.get("notes", { id: input.noteId, topicId: topic.id }))[0],
      );
      const busy = await tx.get("jobs", {
        "kind": "summarize",
        "payload.topicId": topic.id,
        "$or": [{ state: "pending" }, { state: "running" }],
      });

      if (
        busy.length > 0 ||
        current.generation !== topic.generation ||
        current.revision !== topic.revision
      ) {
        throw new HTTPException(409, {
          message: "请等当前整理完成后，编辑最新版本",
        });
      }

      const revision = topic.revision + 1;
      const generation = topic.generation + 1;
      const directory = join(
        bot.config.DATA_DIR,
        "groups",
        topic.groupId,
        "topics",
        topic.id,
        `v${revision}`,
      );

      await mkdir(directory, { recursive: true });
      const markdown = input.markdown.replace(
        /^第 \d+ 版 ·/m,
        `第 ${revision} 版 ·`,
      );
      const path = join(directory, "note.md");
      const temporary = `${path}.${randomUUID()}.part`;
      const source = resolve(dirname(current.path), "transcript.md");

      if (!source.startsWith(`${resolve(bot.config.DATA_DIR)}${sep}`)) {
        throw new HTTPException(400, { message: "原文不在当前数据目录中" });
      }

      await writeFile(
        join(directory, "transcript.md"),
        await readFile(source),
        { mode: 0o600 },
      );
      await writeFile(temporary, markdown, { mode: 0o600 });
      await rename(temporary, path);
      const note = await tx.create("notes", {
        topicId: topic.id,
        groupId: topic.groupId,
        sourceThrough: current.sourceThrough,
        revision,
        generation,
        markdown,
        path,
        sections: [],
        createdAt: Date.now(),
      });

      await tx.set(
        "topics",
        { id: topic.id },
        { revision, generation, noteGeneration: generation },
      );

      return note;
    });

    return ctx.json(note);
  });

  app.delete("/api/groups/:groupId/records/:topicId", async (ctx) => {
    await db.transact(async (tx) => {
      const topic = requireItem(
        (
          await tx.get("topics", {
            id: ctx.req.param("topicId"),
            groupId: ctx.req.param("groupId"),
          })
        )[0],
      );
      const busy = await tx.get("jobs", {
        "payload.topicId": topic.id,
        "state": "running",
      });

      if (busy.length > 0 || bot.running) {
        throw new HTTPException(409, { message: "请先停止机器人，再删除纪要" });
      }

      await rm(
        join(bot.config.DATA_DIR, "groups", topic.groupId, "topics", topic.id),
        { recursive: true, force: true },
      );
      await tx.remove("deliveries", { topicId: topic.id });
      await tx.remove("jobs", { "payload.topicId": topic.id });
      await tx.remove("notes", { topicId: topic.id });
      await tx.remove("topic_messages", { topicId: topic.id });
      await tx.remove("topics", { id: topic.id });
    });

    return ctx.json({ ok: true });
  });
}
