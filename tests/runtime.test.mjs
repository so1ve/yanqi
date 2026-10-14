import assert from "node:assert/strict";
import { test } from "node:test";

import { Type } from "typebox";

import { AiSizeError } from "../packages/bot/src/agent/usage.ts";
import { logContext } from "../packages/bot/src/utils/logging.ts";
import { beijingDate } from "../packages/bot/src/utils/time.ts";
import { modelFixture } from "./fixtures.mjs";

test("结构化输出经过真实流式客户端解析、修复和用量保存，系统提示词由调用者决定", async (t) => {
  const { runtime, store, requests } = await modelFixture(
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
  const { runtime, requests } = await modelFixture(t, [toolReply, toolReply]);
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
  const { runtime } = await modelFixture(t, [
    { delta: { content: "尚未生成完" }, finish: "length" },
    { delta: { content: "" } },
  ]);

  await assert.rejects(runtime.text("summary", "整理讨论。", {}), AiSizeError);
  await assert.rejects(runtime.text("summary", "整理讨论。", {}), /未返回文字/);
});

test("DeepSeek 请求明确区分关闭、low 与 high 思考", async (t) => {
  const { runtime, config, requests } = await modelFixture(t, [
    { delta: { content: "在呢！" } },
    { delta: { content: "在呢！" } },
    { delta: { content: "在呢！" } },
  ]);
  const localURL = `${config.AI_MODEL.baseURL}/chat/completions`;
  const fetch = globalThis.fetch;

  config.AI_MODEL.baseURL = "https://api.deepseek.com/v1";
  config.AI_MODEL.model = "deepseek-flash";
  t.mock.method(globalThis, "fetch", (url, options) => {
    assert.equal(String(url), "https://api.deepseek.com/v1/chat/completions");

    return fetch(localURL, options);
  });

  for (const level of ["off", "low", "high"]) {
    assert.equal(
      await runtime.text(
        "test",
        "测试",
        { text: "在吗" },
        {
          thinking: level,
          tools: [
            {
              name: "reply",
              label: "回复",
              description: "回复",
              parameters: Type.Object({ text: Type.String() }),
              async execute() {
                throw new Error("本用例只检查请求参数");
              },
            },
          ],
          finishTurn: () => ({ action: "end" }),
        },
      ),
      "在呢！",
    );
    const payload = requests.at(-1);

    assert.equal(
      payload.thinking.type,
      level === "off" ? "disabled" : "enabled",
    );
    assert.equal(payload.reasoning_effort, level === "off" ? undefined : level);
    assert.equal(payload.tool_choice, level === "off" ? "required" : "auto");
    assert.equal(
      payload.max_tokens,
      level === "off"
        ? config.AI_MAX_OUTPUT_TOKENS
        : config.AI_THINKING_MAX_OUTPUT_TOKENS,
    );
  }
});
