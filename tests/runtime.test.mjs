import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

import { Type } from "typebox";

import { AgentRuntime } from "../packages/bot/src/agent/runtime.ts";
import { AiSizeError } from "../packages/bot/src/agent/usage.ts";
import { parseConfig } from "../packages/bot/src/config.ts";
import { logContext } from "../packages/bot/src/utils/logging.ts";
import { beijingDate } from "../packages/bot/src/utils/time.ts";
import { fixture } from "./fixtures.mjs";

async function runtimeFixture(t, responses, configOverrides = {}) {
  const { store } = await fixture(t);
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(chunk);
    }

    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    const result = responses.shift();

    if (!result) {
      response.writeHead(500).end("Unexpected request");

      return;
    }

    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (chunk) =>
      response.write(
        `data: ${JSON.stringify({
          id: "test-response",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          ...chunk,
        })}\n\n`,
      );

    send({
      choices: [
        {
          index: 0,
          delta: { role: "assistant", ...result.delta },
          finish_reason: null,
        },
      ],
    });
    send({
      choices: [
        { index: 0, delta: {}, finish_reason: result.finish ?? "stop" },
      ],
    });
    send({
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    });
    response.end("data: [DONE]\n\n");
  });

  t.after(() => {
    server.closeAllConnections();

    return new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const config = parseConfig({
    AI_MODEL: {
      baseURL: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: "test",
      model: "test-model",
    },
    ...configOverrides,
  });

  return {
    runtime: new AgentRuntime(config, store, new AbortController().signal),
    store,
    requests,
  };
}

test("结构化输出经过真实流式客户端解析、修复和用量保存，系统提示词由调用者决定", async (t) => {
  const { runtime, store, requests } = await runtimeFixture(
    t,
    [{ delta: { content: "{answer: '使用 Docker',}" } }],
    { AI_RESPONSE_FORMAT: "json_schema" },
  );
  const schema = Type.Object(
    { answer: Type.String() },
    { additionalProperties: false },
  );
  const result = await logContext.run({ groupId: "100", task: "test" }, () =>
    runtime.json("summary", schema, "只整理部署讨论。", {
      text: "使用 Docker",
    }),
  );

  assert.deepEqual(result, { answer: "使用 Docker" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].response_format.type, "json_schema");
  assert.deepEqual(
    requests[0].response_format.json_schema.schema,
    JSON.parse(JSON.stringify(schema)),
  );
  assert.equal(
    requests[0].messages[0].content,
    `只整理部署讨论。\n最终回复必须是符合以下 JSON Schema 的 JSON 对象：\n${JSON.stringify(schema)}`,
  );
  const usage = await store.usage.summary("100", beijingDate(Date.now()));

  assert.equal(usage.calls, 1);
  assert.equal(usage.models[0].measuredCalls, 1);
  assert.equal(usage.models[0].input, 12);
  assert.equal(usage.models[0].output, 5);
});

const toolReply = {
  delta: {
    tool_calls: [
      {
        index: 0,
        id: "call-1",
        type: "function",
        function: { name: "reply", arguments: '{"text":"在呢！"}' },
      },
    ],
  },
  finish: "tool_calls",
};

test("工具交付后可以没有正文，调用次数上限会停止下一轮请求", async (t) => {
  const { runtime, requests } = await runtimeFixture(t, [toolReply, toolReply]);
  const sent = [];
  const tool = {
    name: "reply",
    label: "回复",
    description: "发送回复",
    parameters: Type.Object({ text: Type.String() }),
    async execute(_id, { text }) {
      sent.push(text);

      return { content: [{ type: "text", text: "已发送" }], details: {} };
    },
  };
  const result = await runtime.text(
    "intent",
    "调用 reply 交付。",
    {},
    {
      tools: [tool],
      finishTurn: () => ({ action: "end" }),
    },
  );

  assert.equal(result, "");
  assert.deepEqual(sent, ["在呢！"]);
  assert.equal(requests[0].tool_choice, "required");
  await assert.rejects(
    runtime.text(
      "intent",
      "调用 reply 交付。",
      {},
      { tools: [tool], maxTurns: 1 },
    ),
    /1 轮模型调用上限/,
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(sent, ["在呢！", "在呢！"]);
});

test("截断和空白模型输出都不能作为成功结果返回", async (t) => {
  const { runtime } = await runtimeFixture(t, [
    { delta: { content: "尚未生成完" }, finish: "length" },
    { delta: { content: "" } },
  ]);

  await assert.rejects(runtime.text("summary", "整理讨论。", {}), AiSizeError);
  await assert.rejects(runtime.text("summary", "整理讨论。", {}), /未返回文字/);
});
