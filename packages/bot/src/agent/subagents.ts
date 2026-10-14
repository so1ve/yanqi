import assert from "node:assert/strict";
import { addAbortListener } from "node:events";

import { failureMessage } from "../utils/errors.ts";
import { beijingTime } from "../utils/time.ts";
import { chatSourceRules } from "./prompts/common.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { SubagentAssignment, SubagentReport } from "./subagent-roles.ts";
import { subagentParameters, subagentRoles } from "./subagent-roles.ts";
import type { ReadContext } from "./tools/context.ts";
import { tool } from "./tools/context.ts";
import type { HistoryMetadata } from "./tools/history.ts";

interface Work {
  assignment: SubagentAssignment;
  state: "running" | "done" | "failed" | "cancelled";
  updated: PromiseWithResolvers<void>;
  report?: SubagentReport;
  metadata?: HistoryMetadata;
  error?: string;
}

// 查阅任务只属于当前对话；持久化纪要仍由原有后台队列负责。
export class Subagents {
  #runtime: AgentRuntime;
  #context: ReadContext;
  #runs = new Map<
    string,
    { work: Work; controller: AbortController; finished: Promise<void> }
  >();

  constructor(runtime: AgentRuntime, context: ReadContext) {
    this.#runtime = runtime;
    this.#context = context;
  }

  public tool() {
    const roles = Object.values(subagentRoles)
      .map((role) => role.description)
      .join("；");

    return tool(
      this.#context,
      "subagent",
      // 工具描述与角色提示词一起维护，确需修改时遵循 prompts/README.md。
      `委派只读查阅助手，最多同时两个。start 选择 kind：${roles}，task 写清问题和结果要求。范围和主题划分已知时直接用 record；拆分多个未知话题时让 history 查明各篇范围。start 返回任务 ID；wait 首次可返回 metadata，此后只等助手主动交付的 brief 或完成结果，后续查询不唤醒等待；cancel 放弃任务。metadata 只表示范围和规模，句柄和翻页留在助手内。两类助手各用自己的查询工具，不能操作记录、发言、写记忆或再委派。结束主对话前完成或取消助手任务。`,
      subagentParameters,
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

        const { metadata, report } = run.work;

        return {
          id,
          state: run.work.state,
          metadata: metadata && {
            selection: metadata.selection,
            title: metadata.title,
            revision: metadata.revision,
            sourceCount: metadata.sourceCount,
            textChars: metadata.textChars,
            attachments: metadata.attachments,
            range: metadata.range,
          },
          brief: report?.brief,
          scope: report?.scope,
          records: report?.records,
          error: run.work.error,
        };
      },
    );
  }

  #start(assignment: SubagentAssignment): string {
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
    const { message } = this.#context;
    const { assignment } = work;
    const role = subagentRoles[assignment.kind];
    const report = tool(
      this.#context,
      "report",
      "向小栖交付 task 的答案、必要引用和影响答案或下一步操作的缺口。done=false 在有需要小栖处理的新发现或工作量变化时发阶段简报后继续，done=true 发最终简报并结束；定位原文范围时可附 scope，任务要求按话题拆分纪要时附 records。简报会连同最新查询元数据唤醒小栖，无需重述数量或逐页汇报。",
      role.report,
      async (args) => {
        work.report = args;

        if (!args.done) {
          work.updated.resolve();
        }

        return { state: args.done ? "done" : "running" };
      },
    );
    const onMetadata = (metadata: HistoryMetadata) => {
      // 首次规模供主对话判断提示；后续查询留在助手内，避免每次查询耗掉主对话一轮。
      if (!work.metadata) {
        work.updated.resolve();
      }

      work.metadata = metadata;
    };

    const tools = role.tools(this.#context, onMetadata);

    await this.#runtime.text(
      `subagent_${assignment.kind}`,
      `${role.instructions}\n${chatSourceRules(this.#context.config.BOT_QQ)}`,
      {
        task: assignment.task,
        ...(await role.input(this.#context, assignment)),
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
        thinking: "high",
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

  public hasPendingRead(): boolean {
    return [...this.#runs.values()].some(
      ({ work }) =>
        work.state === "running" &&
        work.metadata !== undefined &&
        !work.report?.done,
    );
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
