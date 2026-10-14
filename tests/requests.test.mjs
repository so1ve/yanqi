import assert from "node:assert/strict";
import { test } from "node:test";

import { Decisions } from "../packages/bot/src/agent/decisions/index.ts";
import { DialogAI } from "../packages/bot/src/agent/dialog.ts";
import { observeRequests } from "../packages/bot/src/agent/observe.ts";
import { handleRequest } from "../packages/bot/src/agent/requests.ts";
import { parseConfig } from "../packages/bot/src/config.ts";
import { Notes } from "../packages/bot/src/recording/notes.ts";
import { capture, fixture, modelFixture, savedNote } from "./fixtures.mjs";

const call = (name, args, id = name) => ({
  delta: {
    tool_calls: [
      {
        index: 0,
        id: `call-${id}`,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  },
  finish: "tool_calls",
});

for (const addressed of [false, true]) {
  test(
    addressed
      ? "分开发送要求与 @ 时，前一句进入上下文，整理任务由真实工具入队"
      : "决策通过的未 @ 请求启动后台整理，主对话结束不取消整理任务",
    async (t) => {
      const responses = [];
      const { runtime, store, config, requests } = await modelFixture(
        t,
        responses,
        { BOT_QQ: "202" },
      );

      config.DECISION_PROVIDER = "clef";
      config.DECISION_URL = `${new URL(config.AI_MODEL.baseURL).origin}/decision`;
      config.DECISION_API_KEY = "test";
      const signal = new AbortController().signal;
      const ai = {
        decisions: new Decisions(config, store, runtime, signal),
        dialog: new DialogAI(config, runtime, ""),
      };
      const notes = new Notes(config, store, ai, signal);
      const start = Date.parse("2026-10-14T08:00:00+08:00");

      await capture(store, "100", "discussion", {
        sentAt: start,
        text: "确定使用 Docker 部署",
        content: [{ type: "text", data: { text: "确定使用 Docker 部署" } }],
      });
      await capture(store, "200", "unrelated", {
        sentAt: start,
        text: "其他群的资料",
      });
      const text = "总结一下从早上到现在的消息";
      const request = await capture(store, "100", "request", {
        sentAt: start + 10_000,
        text,
        content: [{ type: "text", data: { text } }],
      });
      let trigger = request;

      if (addressed) {
        trigger = await capture(store, "100", "mention", {
          sentAt: start + 17_000,
          addressed: true,
          text: " ",
          content: [{ type: "at", data: { id: "202" } }],
        });
      } else {
        responses.push({
          json: {
            success: true,
            result: {
              answers: {
                [`m${request.id}`]: { choice: "process", confidence: 0.3 },
              },
            },
          },
        });
        const acknowledged = [];

        await observeRequests(
          {
            id: 1,
            kind: "observe",
            payload: { groupId: "100", messageIds: [request.id] },
          },
          config,
          store,
          ai,
          {
            async acknowledge(message) {
              acknowledged.push(message.id);
            },
          },
        );
        assert.deepEqual(acknowledged, [request.id]);
        assert.equal((await store.messages.get(request.id)).command, true);
        const decision = requests.shift();

        assert.equal(decision.questions[`m${request.id}`].type, "choice");
        assert.equal(
          JSON.parse(decision.state).messages[0].id,
          `m${request.id}`,
        );
      }

      if (addressed) {
        responses.push({ delta: { content: "我这就开始整理。" } });
      }

      responses.push(
        call("record", { scope: { day: "today" }, directive: "send" }),
        call("skip_reply", {}),
      );
      await handleRequest(trigger.id, config, store, ai, notes, () => {});
      const state = JSON.parse(requests[0].messages.at(-1).content);

      assert.equal(state.request[0].id, `m${trigger.id}`);
      if (addressed) {
        assert.ok(
          state.context.some(
            (message) =>
              message.id === `m${request.id}` && message.text === text,
          ),
        );
      }

      const summaries = (await store.jobs.forGroup("100")).filter(
        (job) => job.kind === "summarize",
      );

      assert.equal(summaries.length, 1);
      assert.equal(summaries[0].state, "pending");
      assert.equal(summaries[0].payload.requested, true);
      assert.equal(
        (await store.topics.get(summaries[0].payload.topicId)).directive,
        "send",
      );
      assert.deepEqual(await store.deliveries.forRequest(trigger.id), []);
      assert.equal(requests.length, addressed ? 3 : 2);
      assert.equal((await store.jobs.forGroup("200")).length, 0);
      const conversation = await store.conversations.open("100");

      assert.equal(conversation.messages.at(-1).toolName, "skip_reply");
      assert.equal(responses.length, 0);
    },
  );
}

test("整理返回嵌套转发和待解析附件的规模，提示只发送一次且不等待整理结束", async (t) => {
  const responses = [];
  const { runtime, store, config } = await modelFixture(t, responses);
  const ai = { dialog: new DialogAI(config, runtime, "") };
  const notes = new Notes(config, store, ai, new AbortController().signal);
  const source = await capture(store, "100", "forward", {
    text: "请看方案",
    content: [{ type: "forward", data: { id: "card" } }],
  });
  const image = { type: "image", data: { url: "https://example.test/image" } };
  const audio = { type: "record", data: { url: "https://example.test/audio" } };
  const [card] = await store.assets.forMessage(source.id);
  const forwarded = (content) => ({
    sender: { user_id: "301", nickname: "讨论者" },
    time: 1,
    content,
  });
  const outerText = "确认部署方式。";
  const innerText = "还需比较备份方案。";
  const interpretation = "架构图的识别内容";

  await store.assets.save(
    card.id,
    "saved",
    null,
    JSON.stringify([
      forwarded([
        { type: "text", data: { text: outerText } },
        {
          type: "forward",
          data: {
            id: "nested",
            content: [
              forwarded([
                { type: "text", data: { text: innerText } },
                image,
                audio,
              ]),
            ],
          },
        },
      ]),
    ]),
    null,
  );
  await store.assets.capture(source, [image, audio]);
  const images = await store.assets.forMessage(source.id);

  await store.assets.save(
    images.find((asset) => asset.kind === "image").id,
    "saved",
    null,
    interpretation,
    null,
  );
  await capture(store, "200", "unrelated-image", { content: [image] });
  const request = await capture(store, "100", "summarize", {
    text: "帮我整理这份转发里的讨论",
    addressed: true,
  });
  const notice = "这份讨论内容比较多，我会把重点理清楚，整理好了发给你！";

  responses.push(
    call("record", {
      scope: { sourceIds: [`m${source.id}`] },
      directive: "send",
    }),
    call("notify", { text: notice }),
    call("notify", { text: "不应重复发送" }, "notify-again"),
    call("skip_reply", {}),
  );
  // 只模拟发送边界，整理任务和通知入队仍经过实际工具与数据库。
  const sending = [];
  const sent = [];
  const wake = () =>
    sending.push(
      (async () => {
        const delivery = await store.deliveries.next("text");

        if (delivery) {
          sent.push(delivery);
          await store.deliveries.done(delivery.id);
        }
      })(),
    );

  await handleRequest(request.id, config, store, ai, notes, wake);
  await Promise.all(sending);
  const conversation = await store.conversations.open("100");
  const result = JSON.parse(
    conversation.messages.find(
      (message) =>
        message.role === "toolResult" && message.toolName === "record",
    ).content[0].text,
  );

  assert.equal(result.sourceCount, 1);
  assert.deepEqual(result.workload, {
    sourcesToRead: 1,
    textChars: source.text.length,
    attachments: {
      count: 3,
      pending: 1,
      failed: 0,
      parsedTextChars:
        outerText.length + innerText.length + interpretation.length,
      forwardedMessages: 2,
    },
    reusedSections: 0,
    charsPerBatch: Math.floor(config.AI_INPUT_CHARS / 4),
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].groupId, "100");
  assert.equal(sent[0].content, notice);
  assert.equal((await store.jobs.get("100", result.taskId)).state, "pending");
  assert.equal(conversation.messages.at(-1).toolName, "skip_reply");
  assert.equal(responses.length, 0);
});

test("整理工作量排除可复用原文，直接发送已保存版本不报告待整理内容", async (t) => {
  const { store, directory } = await fixture(t);
  const config = parseConfig({});
  const notes = new Notes(config, store, {}, new AbortController().signal);
  const original = await capture(store, "100", "original");
  const note = await savedNote(store, directory, original);
  const additional = await capture(store, "100", "additional", {
    text: "补充备份",
  });
  const request = await capture(store, "100", "update", { addressed: true });
  const saved = await notes.arrange(
    await store.topics.get(note.topicId),
    request.id,
  );

  assert.equal(saved.state, "saved");
  assert.equal(saved.workload, undefined);
  const updated = await store.recordings.revise(note.topicId, {
    messageIds: [original.id, additional.id],
  });
  const result = await notes.arrange(updated, request.id);

  assert.equal(result.sourceCount, 2);
  assert.equal(result.workload.sourcesToRead, 1);
  assert.equal(result.workload.textChars, additional.text.length);
  assert.equal(result.workload.reusedSections, 1);
  const narrowed = await store.recordings.revise(note.topicId, {
    messageIds: [original.id],
  });
  const remaining = await notes.arrange(narrowed, request.id);

  assert.equal(remaining.workload.sourcesToRead, 0);
  assert.equal(remaining.workload.textChars, 0);
  assert.equal(remaining.workload.reusedSections, 1);
  assert.deepEqual(remaining.workload.attachments, {
    count: 0,
    pending: 0,
    failed: 0,
    parsedTextChars: 0,
    forwardedMessages: 0,
  });
});
