import type { AgentState } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "typebox";
import { Type } from "typebox";

import { contextWithin } from "../recording/messages.ts";
import { sourceScope } from "../recording/sources.ts";
import { subagentPrompts } from "./prompts/subagent.ts";
import type { ReadContext } from "./tools/context.ts";
import { object } from "./tools/context.ts";
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

interface Role {
  description: string;
  parameters: TSchema;
  report: typeof reportSchema | typeof historyReportSchema;
  instructions: string;
  tools: (
    context: ReadContext,
    onMetadata: (metadata: HistoryMetadata) => void,
  ) => AgentState["tools"];
  input: (
    context: ReadContext,
    assignment: { task: string; scope?: Static<typeof sourceScope> },
  ) => Promise<Record<string, unknown>>;
}

// 分工的参数、输入和工具在同一处声明，调度器不再按 kind 拼装能力。
export const subagentRoles = {
  history: {
    description: "history 查聊天、确定讨论范围或提取信息，可带 scope",
    parameters: object({
      action: Type.Literal("start"),
      kind: Type.Literal("history"),
      task: taskDescription,
      scope: Type.Optional(sourceScope),
    }),
    report: historyReportSchema,
    instructions: subagentPrompts.history,
    tools: chatHistoryTools,
    async input({ message, store }, assignment) {
      const quote = message.replyTo
        ? await store.messages.quoted(message.groupId, message.replyTo)
        : null;

      return {
        scope: assignment.scope,
        availableHistory: await store.messages.availableHistory(
          message.groupId,
          message.id,
        ),
        quoted: quote ? await contextWithin(store, [quote], 1500) : [],
      };
    },
  },
  notes: {
    description:
      "notes 查已保存纪要、理解内容或比较版本，task 写明文档线索和版本",
    parameters: object({
      action: Type.Literal("start"),
      kind: Type.Literal("notes"),
      task: taskDescription,
    }),
    report: reportSchema,
    instructions: subagentPrompts.notes,
    tools: (context, onMetadata) => [
      readTool(context),
      ...noteHistoryTools(context, onMetadata),
    ],
    input: () => Promise.resolve({}),
  },
} satisfies Record<string, Role>;

export const subagentParameters = Type.Union([
  subagentRoles.history.parameters,
  subagentRoles.notes.parameters,
  object({
    action: Type.Union([Type.Literal("wait"), Type.Literal("cancel")]),
    id: Type.String(),
  }),
]);

export type SubagentAssignment = Extract<
  Static<typeof subagentParameters>,
  { action: "start" }
>;
export type SubagentReport = Static<typeof historyReportSchema>;
