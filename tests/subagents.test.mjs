import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import * as Value from "typebox/value";

import { Subagents } from "../packages/bot/src/agent/subagents.ts";
import { parseConfig } from "../packages/bot/src/config.ts";
import { capture, fixture, savedNote } from "./fixtures.mjs";

async function call(tool, args, signal) {
  const result = await tool.execute("call", args, signal);

  return JSON.parse(result.content[0].text);
}

test("查阅先返回元数据，再等待内容简报，不因等待时间自行唤醒", async (t) => {
  const { store } = await fixture(t);
  const source = await capture(store, "100", "1", { text: "确定使用 Docker" });

  await capture(store, "200", "1", { text: "其他群的讨论" });
  const message = await capture(store, "100", "2", {
    addressed: true,
    text: "总结部署方案",
  });
  const readAllowed = Promise.withResolvers();
  let readMessages;
  // 只替换模型，查询和工具执行使用真实实现。
  const runtime = {
    async text(_purpose, _instructions, _input, { tools, signal }) {
      assert.deepEqual(tools.map((tool) => tool.name).sort(), [
        "history",
        "read_history",
        "report",
      ]);
      const byName = (name) => tools.find((tool) => tool.name === name);
      const metadata = await call(
        byName("history"),
        {
          action: "messages",
          scope: { sourceIds: [`m${source.id}`] },
        },
        signal,
      );

      await readAllowed.promise;
      signal.throwIfAborted();
      const page = await call(
        byName("read_history"),
        { handle: metadata.handle, page: 0 },
        signal,
      );

      readMessages = page.messages;
      await call(
        byName("report"),
        { brief: "已确定使用 Docker。", done: true },
        signal,
      );

      return "";
    },
  };
  const subagents = new Subagents(runtime, {
    store,
    message,
    config: parseConfig({}),
  });
  const tool = subagents.tool();

  try {
    const started = await call(tool, {
      action: "start",
      kind: "history",
      task: "找出部署方案",
    });
    const metadata = await call(tool, { action: "wait", id: started.id });

    assert.equal(metadata.state, "running");
    assert.equal(metadata.metadata.sourceCount, 1);
    assert.equal(metadata.brief, null);
    assert.equal(readMessages, undefined);
    assert.throws(() => subagents.assertIdle());
    let returned = false;
    const waiting = call(tool, { action: "wait", id: started.id }).then(
      (result) => {
        returned = true;

        return result;
      },
    );

    await setImmediate();
    assert.equal(returned, false);
    readAllowed.resolve();
    const completed = await waiting;

    assert.equal(completed.state, "done");
    assert.equal(completed.brief, "已确定使用 Docker。");
    assert.deepEqual(
      readMessages.map((message) => message.id),
      [`m${source.id}`],
    );
    subagents.assertIdle();
  } finally {
    readAllowed.resolve();
    await subagents.close();
  }
});

test("纪要助手只拥有纪要查询能力，参数和句柄不能跨分工使用", async (t) => {
  const { store, directory } = await fixture(t);
  const source = await capture(store, "100", "1");
  const note = await savedNote(store, directory, source);
  const message = await capture(store, "100", "2", { addressed: true });
  let markdown;
  const runtime = {
    async text(_purpose, _instructions, _input, { tools, signal }) {
      assert.deepEqual(tools.map((tool) => tool.name).sort(), [
        "note",
        "read",
        "read_history",
        "report",
      ]);
      const byName = (name) => tools.find((tool) => tool.name === name);

      await assert.rejects(
        call(byName("read_history"), { handle: "h1" }, signal),
        /本次查阅没有这个句柄/,
      );
      const metadata = await call(
        byName("note"),
        { topicId: note.topicId, revision: 1 },
        signal,
      );
      const page = await call(
        byName("read_history"),
        { handle: metadata.handle },
        signal,
      );

      markdown = page.markdown;
      await call(
        byName("report"),
        { brief: "第 1 版采用 Docker。", done: true },
        signal,
      );

      return "";
    },
  };
  const subagents = new Subagents(runtime, {
    store,
    message,
    config: parseConfig({}),
  });
  const tool = subagents.tool();

  try {
    assert.equal(
      Value.Check(tool.parameters, {
        action: "start",
        kind: "notes",
        task: "查阅纪要",
        scope: { all: true },
      }),
      false,
    );
    assert.equal(
      Value.Check(tool.parameters, {
        action: "start",
        kind: "unknown",
        task: "查阅纪要",
      }),
      false,
    );
    const started = await call(tool, {
      action: "start",
      kind: "notes",
      task: "查阅第 1 版",
    });

    await call(tool, { action: "wait", id: started.id });
    const completed = await call(tool, { action: "wait", id: started.id });

    assert.equal(completed.state, "done");
    assert.equal(markdown, note.markdown);
    assert.equal(completed.scope, null);
  } finally {
    await subagents.close();
  }
});

test("子任务可以取消，任务 ID 不能跨请求继续使用", async (t) => {
  const { store } = await fixture(t);
  const message = await capture(store, "100", "1", { addressed: true });
  const runtime = {
    async text(_purpose, _instructions, _input, { signal }) {
      signal.throwIfAborted();
      await once(signal, "abort");
      signal.throwIfAborted();

      return "";
    },
  };
  const context = { store, message, config: parseConfig({}) };
  const first = new Subagents(runtime, context);
  const second = new Subagents(runtime, context);

  try {
    const started = await call(first.tool(), {
      action: "start",
      kind: "history",
      task: "查阅讨论",
    });

    await assert.rejects(
      call(second.tool(), { action: "wait", id: started.id }),
      /本次对话没有子任务/,
    );
    const cancelled = await call(first.tool(), {
      action: "cancel",
      id: started.id,
    });

    assert.equal(cancelled.state, "cancelled");
    first.assertIdle();
  } finally {
    await first.close();
    await second.close();
  }
});
