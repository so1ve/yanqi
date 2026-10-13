import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import type { Static } from "typebox";
import { Type } from "typebox";

import { contextWithin } from "../recording/messages.ts";
import { sourceScope } from "../recording/sources.ts";
import { failureMessage } from "../utils/errors.ts";
import { beijingTime } from "../utils/time.ts";
import { subagentPrompt } from "./prompts/subagent.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { ToolContext } from "./tools/context.ts";
import { object, tool } from "./tools/context.ts";
import { historyTool } from "./tools/history.ts";
import { readTool } from "./tools/read.ts";

const reportSchema = object({
  brief: Type.String({ minLength: 1, maxLength: 1600 }),
  scope: Type.Optional(sourceScope),
  done: Type.Boolean(),
});
const parameters = Type.Union([
  object({
    action: Type.Literal("start"),
    task: Type.String({ minLength: 1, maxLength: 2000 }),
    scope: Type.Optional(sourceScope),
  }),
  object({
    action: Type.Union([
      Type.Literal("wait"),
      Type.Literal("inspect"),
      Type.Literal("cancel"),
    ]),
    id: Type.String(),
  }),
]);

interface Work {
  task: string;
  startedAt: number;
  state: "running" | "done" | "failed" | "cancelled";
  report?: Static<typeof reportSchema>;
  error?: string;
}

// 查阅任务只属于当前对话；持久化纪要仍由原有后台队列负责。
export class Subagents {
  #runtime: AgentRuntime;
  #context: ToolContext;
  #runs = new Map<
    string,
    { work: Work; controller: AbortController; finished: Promise<void> }
  >();

  constructor(runtime: AgentRuntime, context: ToolContext) {
    this.#runtime = runtime;
    this.#context = context;
  }

  public tool() {
    return tool(
      this.#context,
      "subagent",
      "委派独立资料助手检索上下文、确定记录范围、比较纪要或提取信息。start 给出具体任务和可选 scope，不传整段历史，先等待最多 5 秒；助手自行查原文，只返回简报和必要 ID，不操作记录或发言。最多同时运行两个。wait 最多等待 30 秒，未结束时返回已有简报，可继续 wait；inspect 立即查看；cancel 放弃任务。最终 reply 前须完成或取消查阅任务。",
      parameters,
      async (args, signal) => {
        const id =
          args.action === "start"
            ? this.#start(args.task, args.scope)
            : args.id;
        const run = this.#runs.get(id);

        if (!run) {
          throw new Error(`本次对话没有子任务 ${id}`);
        }

        if (args.action === "cancel") {
          run.controller.abort();
          await run.finished;
        } else if (
          (args.action === "start" || args.action === "wait") &&
          run.work.state === "running"
        ) {
          const timer = new AbortController();

          try {
            await Promise.race([
              run.finished,
              delay(args.action === "start" ? 5000 : 30_000, undefined, {
                signal: signal
                  ? AbortSignal.any([signal, timer.signal])
                  : timer.signal,
              }),
            ]);
          } finally {
            timer.abort();
          }
        }

        signal?.throwIfAborted();

        return {
          id,
          task: run.work.task,
          state: run.work.state,
          elapsedMs: Date.now() - run.work.startedAt,
          brief: run.work.report?.brief ?? null,
          scope: run.work.report?.scope ?? null,
          error: run.work.error ?? null,
        };
      },
    );
  }

  #start(task: string, scope: Static<typeof sourceScope> | undefined): string {
    if (
      [...this.#runs.values()].filter(({ work }) => work.state === "running")
        .length >= 2
    ) {
      throw new Error("已有两个子任务在运行，请先等待或取消其中一个");
    }

    const id = `s${this.#runs.size + 1}`;
    const work: Work = { task, startedAt: Date.now(), state: "running" };
    const controller = new AbortController();
    const finished = this.#run(work, scope, controller.signal).then(
      () => {
        work.state = "done";
      },
      (error: unknown) => {
        work.state = controller.signal.aborted ? "cancelled" : "failed";
        work.error = failureMessage(error);
      },
    );

    this.#runs.set(id, { work, controller, finished });

    return id;
  }

  async #run(
    work: Work,
    scope: Static<typeof sourceScope> | undefined,
    signal: AbortSignal,
  ) {
    const { message, store } = this.#context;
    const quote = message.replyTo
      ? await store.messages.quoted(message.groupId, message.replyTo)
      : null;
    const report = tool(
      this.#context,
      "report",
      "向小栖提供简报；done=true 交付最终结果并结束查阅。",
      reportSchema,
      async (args) => {
        work.report = args;

        return { state: args.done ? "done" : "running" };
      },
    );

    await this.#runtime.text(
      "subagent",
      subagentPrompt,
      {
        task: work.task,
        scope,
        quoted: quote ? await contextWithin(store, [quote], 1500) : [],
        request: {
          id: `m${message.id}`,
          author: message.displayName,
          userId: message.userId,
          text: message.text,
          time: beijingTime(message.sentAt),
        },
      },
      {
        signal,
        thinking: true,
        maxTurns: 16,
        tools: [historyTool(this.#context), readTool(this.#context), report],
        finishTurn: ({ message }) => ({
          action:
            work.report?.done ||
            ["aborted", "error", "length"].includes(message.stopReason)
              ? "end"
              : "continue",
        }),
      },
    );
    assert.ok(work.report?.done, "资料助手未交付最终简报");
  }

  public assertIdle(): void {
    if ([...this.#runs.values()].some(({ work }) => work.state === "running")) {
      throw new Error(
        "还有查阅任务未完成。可用 notify 提示进度，继续 subagent(wait)；不再需要的任务先 cancel。reply 会结束对话。",
      );
    }
  }

  public async close(): Promise<void> {
    for (const run of this.#runs.values()) {
      run.controller.abort();
    }

    await Promise.all([...this.#runs.values()].map((run) => run.finished));
  }
}
