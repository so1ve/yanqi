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
  object({ action: Type.Literal("start"), title, directive }),
  object({
    action: Type.Literal("stop"),
    topicId: Type.Optional(topicId),
    include: Type.Optional(sourceScope),
    directive,
  }),
]);

export function followTool(context: ToolContext) {
  const { store, message, isAdmin, notes, wake } = context;

  return tool(
    context,
    "follow",
    "开始或结束连续记录。每位成员在本群最多同时发起一段；stop 不填 topicId 时选请求者的记录，只有发起人或管理员可结束。include 可把更早的讨论并入同一份纪要，不另建重复记录。回顾历史用 record。",
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

        const topic = await store.recordings.create(message, {
          title: args.title || "连续讨论记录",
          messages: "following",
          directive: args.directive ?? "auto",
        });

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
        return "没有找到正在进行的手动记录。";
      }

      if (!isAdmin && topic.ownerId !== message.userId) {
        throw new Error("请记录的发起人或管理员结束这段记录");
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
