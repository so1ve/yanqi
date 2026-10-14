import assert from "node:assert/strict";
import { test } from "node:test";

import { Decisions } from "../packages/bot/src/agent/decisions/index.ts";
import { DialogAI } from "../packages/bot/src/agent/dialog.ts";
import { observeRequests } from "../packages/bot/src/agent/observe.ts";
import { handleRequest } from "../packages/bot/src/agent/requests.ts";
import { Notes } from "../packages/bot/src/recording/notes.ts";
import { capture, modelFixture } from "./fixtures.mjs";

const call = (name, args) => ({
  delta: {
    tool_calls: [
      {
        index: 0,
        id: `call-${name}`,
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
