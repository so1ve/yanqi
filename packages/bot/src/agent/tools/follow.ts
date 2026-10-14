import assert from "node:assert/strict";

import { Type } from "typebox";

import { selectSources, sourceScope } from "../../recording/sources.ts";
import type { ToolContext } from "./context.ts";
import {
  directive,
  getTopic,
  object,
  title,
  tool,
  topicId,
} from "./context.ts";

const parameters = Type.Union([
  object({
    action: Type.Literal("start"),
    title,
    include: Type.Optional(sourceScope),
    directive,
  }),
  object({
    action: Type.Literal("stop"),
    topicId: Type.Optional(topicId),
    include: Type.Optional(sourceScope),
    directive,
  }),
]);

export function followTool(context: ToolContext) {
  const { store, message, notes, wake } = context;

  return tool(
    context,
    "follow",
    "按用户当前的要求开始或结束连续记录。只有明确要求记录后续讨论时才 start，提到开始记录不等于要求执行；include 可在开始或结束时把已讨论的内容并入同一份记录。每位请求者在本群最多同时发起一段；stop 不填 topicId 时选请求者的记录，也可指定本群其他记录。只回顾已有内容用 record。",
    parameters,
    async (args) => {
      const owned = await store.topics.following(
        message.groupId,
        message.userId,
      );

      if (args.action === "start") {
        if (owned.length > 0) {
          return `你已有正在进行的记录：${owned.map((topic) => `「${topic.title}」`).join("、")}。`;
        }

        const included = args.include
          ? await selectSources(store, message, args.include)
          : [];
        const [topic] = await store.recordings.create(message, [
          {
            title: args.title || "连续讨论记录",
            messages: included.map((source) => source.id),
            following: true,
            directive: args.directive ?? "auto",
          },
        ]);

        assert.ok(topic);

        return { topicId: topic.id, title: topic.title, state: "following" };
      }

      const topic = args.topicId
        ? await getTopic(context, args.topicId)
        : (owned[0] ??
          (await store.recordings.lastStopped(
            message.groupId,
            message.userId,
          )));

      if (topic?.mode !== "manual") {
        return "没有找到正在进行的连续记录。";
      }

      if (topic.state === "closed" && topic.endedAtMessageId === null) {
        return notes.arrange(topic, message.id);
      }

      const included = args.include
        ? await selectSources(store, message, args.include)
        : [];
      const stopped = await store.recordings.stop(
        topic.id,
        message.id,
        included.map((source) => source.id),
        args.directive,
      );
      const result = await notes.arrange(stopped, message.id);

      wake();

      return result;
    },
  );
}
