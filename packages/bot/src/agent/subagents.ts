import assert from "node:assert/strict";
import { addAbortListener } from "node:events";

import type { Static } from "typebox";
import { Type } from "typebox";

import { contextWithin } from "../recording/messages.ts";
import { sourceScope } from "../recording/sources.ts";
import { failureMessage } from "../utils/errors.ts";
import { beijingTime } from "../utils/time.ts";
import { subagentPrompts } from "./prompts/subagent.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { ToolContext } from "./tools/context.ts";
import { object, tool } from "./tools/context.ts";
import type { HistoryMetadata } from "./tools/history.ts";
import { chatHistoryTools, noteHistoryTools } from "./tools/history.ts";
import { readTool } from "./tools/read.ts";

const reportSchema = object({
  brief: Type.String({
    minLength: 1,
    maxLength: 1600,
    description:
      "已查明的内容、工具返回的资料规模和仍需查阅的部分，供小栖判断后续工作。",
  }),
  done: Type.Boolean(),
});
const historyReportSchema = object({
  ...reportSchema.properties,
  scope: Type.Optional(sourceScope),
});
const taskDescription = Type.String({ minLength: 1, maxLength: 2000 });
const parameters = Type.Union([
  object({
    action: Type.Literal("start"),
    kind: Type.Literal("history"),
    task: taskDescription,
    scope: Type.Optional(sourceScope),
  }),
  object({
    action: Type.Literal("start"),
    kind: Type.Literal("notes"),
    task: taskDescription,
  }),
  object({
    action: Type.Union([Type.Literal("wait"), Type.Literal("cancel")]),
    id: Type.String(),
  }),
]);

type Assignment = Extract<Static<typeof parameters>, { action: "start" }>;

interface Work {
  assignment: Assignment;
  state: "running" | "done" | "failed" | "cancelled";
  updated: PromiseWithResolvers<void>;
  report?: Static<typeof historyReportSchema>;
  metadata?: HistoryMetadata;
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
      "委派只读助手。start 必须选择 kind：history 查聊天、确定讨论范围或提取信息，可带 scope；notes 查已保存纪要、理解内容或比较版本，task 写明文档线索和版本。两类工具互不混用，不能修改数据、发言或再委派。任务同时涉及原文和纪要时分别委派并汇合简报。助手先查元数据，再用句柄读正文。最多同时运行两个。start 立即返回任务 ID；wait 等到新元数据、简报或完成结果才返回，不定时唤醒。metadata 表示资料规模和范围，不代表已读正文。cancel 放弃任务。结束对话前须完成或取消查阅任务。",
      parameters,
      async (args, signal) => {
        const id = args.action === "start" ? this.#start(args) : args.id;
        const run = this.#runs.get(id);

        if (!run) {
          throw new Error(`本次对话没有子任务 ${id}`);
        }

        if (args.action === "cancel") {
          run.controller.abort();
          await run.finished;
        } else if (args.action === "wait" && run.work.state === "running") {
          const aborted = Promise.withResolvers<never>();
          const listener = signal
            ? addAbortListener(signal, () => aborted.reject(signal.reason))
            : undefined;

          try {
            await Promise.race([
              run.finished,
              run.work.updated.promise,
              aborted.promise,
            ]);
          } finally {
            listener?.[Symbol.dispose]();
          }
        }

        signal?.throwIfAborted();
        run.work.updated = Promise.withResolvers<void>();

        return {
          id,
          kind: run.work.assignment.kind,
          task: run.work.assignment.task,
          state: run.work.state,
          metadata: run.work.metadata ?? null,
          brief: run.work.report?.brief ?? null,
          scope: run.work.report?.scope ?? null,
          error: run.work.error ?? null,
        };
      },
    );
  }

  #start(assignment: Assignment): string {
    if (
      [...this.#runs.values()].filter(({ work }) => work.state === "running")
        .length >= 2
    ) {
      throw new Error("已有两个子任务在运行，请先等待或取消其中一个");
    }

    const id = `s${this.#runs.size + 1}`;
    const work: Work = {
      assignment,
      state: "running",
      updated: Promise.withResolvers<void>(),
    };
    const controller = new AbortController();
    const finished = this.#run(work, controller.signal).then(
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

  async #run(work: Work, signal: AbortSignal) {
    const { message, store } = this.#context;
    const { assignment } = work;
    const quote =
      assignment.kind === "history" && message.replyTo
        ? await store.messages.quoted(message.groupId, message.replyTo)
        : null;
    const report = tool(
      this.#context,
      "report",
      "向小栖提供内容简报和已知资料规模。done=false 立即交付中间简报并继续查阅；done=true 交付最终结果并结束查阅。",
      assignment.kind === "history" ? historyReportSchema : reportSchema,
      async (args) => {
        work.report = args;

        if (!args.done) {
          work.updated.resolve();
        }

        return { state: args.done ? "done" : "running" };
      },
    );
    const onMetadata = (metadata: HistoryMetadata) => {
      work.metadata = metadata;
      work.updated.resolve();
    };

    // 每次只注册该分工的工具；SDK 按此列表查找工具并校验参数后才执行。
    const tools =
      assignment.kind === "history"
        ? chatHistoryTools(this.#context, onMetadata)
        : [
            readTool(this.#context),
            ...noteHistoryTools(this.#context, onMetadata),
          ];

    await this.#runtime.text(
      `subagent_${assignment.kind}`,
      subagentPrompts[assignment.kind],
      {
        task: assignment.task,
        ...(assignment.kind === "history"
          ? {
              scope: assignment.scope,
              availableHistory: await store.messages.availableHistory(
                message.groupId,
                message.id,
              ),
            }
          : {}),
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
        tools: [...tools, report],
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
        "还有查阅任务未完成，请继续 subagent(wait)；不再需要的任务先 cancel，再用 reply 或 skip_reply 结束对话。",
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
