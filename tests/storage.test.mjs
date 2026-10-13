import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { StoreError } from "../packages/bot/src/storage/errors.ts";
import { capture, fixture, savedNote } from "./fixtures.mjs";

test("消息、引用、附件和纪要查询保持群隔离", async (t) => {
  const { store, directory } = await fixture(t);
  const first = await capture(store, "100", "1", {
    sentAt: 3000,
    text: "发布 Alpha",
    content: [
      { type: "image", data: { url: "https://example.test/image.png" } },
    ],
  });
  const earlier = await capture(store, "100", "2", {
    sentAt: 2000,
    displayName: "新昵称",
  });
  const other = await capture(store, "200", "1", {
    text: "其他群的内容",
    role: "member",
  });

  assert.deepEqual(await store.messages.ids("100"), [earlier.id, first.id]);
  assert.deepEqual(await store.messages.ids("100", "alpha"), [first.id]);
  assert.deepEqual(
    (await store.messages.read("100", [other.id, first.id])).map((m) => m.id),
    [first.id],
  );
  assert.equal(
    (await store.messages.quotes("100", ["1"]))[0].text,
    "发布 Alpha",
  );
  assert.equal(
    (await store.messages.names("100", ["101"])).get("101"),
    "新昵称",
  );
  assert.equal(await store.inbox.getRequest(other.id), null);
  assert.deepEqual(await store.inbox.scheduleRequests("100", [other.id]), []);
  const [asset] = await store.assets.forMessages([first.id]);

  assert.equal((await store.assets.find("100", asset.id)).id, asset.id);
  assert.equal(await store.assets.find("200", asset.id), undefined);
  const note = await savedNote(store, directory, first);

  assert.equal(
    await store.notes.version("200", note.topicId, note.id),
    undefined,
  );
  assert.equal(
    (await store.topics.page("200", { offset: 0, limit: 30 })).total,
    0,
  );
  assert.deepEqual(await store.notes.sourceMessageIds(note), [first.id]);
});

test("手工编辑生成新版本，拒绝旧版本和整理期间的编辑", async (t) => {
  const { store, directory } = await fixture(t);
  const message = await capture(store, "100", "1");
  const original = await savedNote(store, directory, message);
  const input = {
    noteId: original.id,
    markdown: "# 修订\n\n第 1 版 · 1 条原始消息\n\n已确认。",
  };

  await assert.rejects(store.notes.edit("200", original.topicId, input), {
    kind: "not_found",
  });
  const results = await Promise.allSettled([
    store.notes.edit("100", original.topicId, input),
    store.notes.edit("100", original.topicId, input),
  ]);
  const edited = results.find((result) => result.status === "fulfilled").value;
  const rejected = results.find(
    (result) => result.status === "rejected",
  ).reason;

  assert.equal(rejected instanceof StoreError, true);
  assert.equal(rejected.kind, "conflict");
  assert.equal(edited.revision, 2);
  assert.match(await readFile(edited.path, "utf8"), /第 2 版/);
  assert.equal(
    await readFile(join(edited.path, "..", "transcript.md"), "utf8"),
    "原始讨论",
  );
  assert.deepEqual(await store.notes.sourceMessageIds(edited), [message.id]);
  assert.equal(
    (await store.notes.version("100", original.topicId, original.id)).markdown,
    original.markdown,
  );

  const taskId = await store.topics.regenerate(
    "100",
    original.topicId,
    "补充结论",
  );
  const updated = await store.topics.get(original.topicId);

  await assert.rejects(
    store.topics.regenerate("100", original.topicId, "不应写入"),
    { kind: "conflict" },
  );
  await assert.rejects(
    store.notes.edit("100", original.topicId, { ...input, noteId: edited.id }),
    { kind: "conflict" },
  );
  assert.equal((await store.topics.get(original.topicId)).focus, "补充结论");
  assert.equal((await store.notes.versions(original.topicId)).length, 2);
  assert.equal(updated.generation, edited.generation + 1);
  assert.equal((await store.jobs.get("100", taskId)).payload.publish, false);
});

test("删除纪要拒绝正在运行的任务，仅删除该纪要的派生数据", async (t) => {
  const { store, directory } = await fixture(t);
  const message = await capture(store, "100", "1");
  const otherMessage = await capture(store, "200", "1");
  const note = await savedNote(store, directory, message);
  const other = await savedNote(store, directory, otherMessage);
  const delivery = await store.deliveries.enqueueNote(note);

  await assert.rejects(store.topics.remove("200", note.topicId), {
    kind: "not_found",
  });
  const taskId = await store.topics.regenerate("100", note.topicId, "重新整理");

  await store.jobs.claim("summarize", Date.now());
  await assert.rejects(store.topics.remove("100", note.topicId), {
    kind: "conflict",
  });
  await store.jobs.done(taskId);
  await store.topics.remove("100", note.topicId);

  assert.equal(await store.topics.find("100", note.topicId), undefined);
  assert.equal(await store.deliveries.find("100", delivery.id), undefined);
  assert.equal(
    (await store.jobs.page("100", { offset: 0, limit: 30 })).total,
    0,
  );
  await assert.rejects(readFile(note.path), { code: "ENOENT" });
  assert.deepEqual(await store.messages.ids("100"), [message.id]);
  assert.equal(
    (await store.notes.version("200", other.topicId, other.id)).id,
    other.id,
  );
});

test("修改密码在同一事务内撤销已有会话", async (t) => {
  const { accounts } = await fixture(t);

  await accounts.initialize("first-hash");
  await accounts.createSession("active", 2000);
  await accounts.createSession("expired", 500);
  assert.equal(await accounts.hasSession("active", 1000), true);
  assert.equal(await accounts.hasSession("expired", 1000), false);

  await accounts.replacePassword("new-hash");

  assert.equal(await accounts.password(), "new-hash");
  assert.equal(await accounts.hasSession("active", 1000), false);
});
