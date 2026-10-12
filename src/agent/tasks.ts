import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { Message } from "../types.ts";

const parameters = Type.Object(
  {
    id: Type.Integer({
      minimum: 1,
      description: "附件上下文、status 或 inspect 返回的任务 ID",
    }),
    action: Type.Union([
      Type.Literal("inspect"),
      Type.Literal("wait"),
      Type.Literal("retry"),
    ]),
  },
  { additionalProperties: false },
);

export const taskTool = (
  store: Store,
  message: Message,
  config: Config,
  isAdmin: boolean,
  processPending: () => void,
): AgentTool<typeof parameters> => ({
  name: "task",
  label: "查看或等待后台任务",
  description:
    "inspect 获取具体任务的进度、失败原因和结果；wait 等待完成并读取最新结果，适用于识图、附件和纪要。问图片内容时先等待对应任务，不让用户反复追问。retry 重试指定失败任务并等待，附件可直接重试，其他任务需要管理员权限。不会重新执行对话。",
  parameters,
  execute: async (_callId, { id, action }, signal) => {
    if ((await store.message(message.id)).recalledAt !== null) {
      throw new Error("这次请求已撤回");
    }

    const job = await store.jobs.get(message.groupId, id);

    if (action !== "inspect") {
      if (job.kind === "intent") {
        throw new Error(
          "对话不能从头重跑或相互等待，请查询它依赖的附件或纪要任务",
        );
      }

      if (action === "retry") {
        if (job.kind !== "asset" && !isAdmin) {
          throw new Error("只有管理员可以重试整理或话题识别任务");
        }

        if (job.state === "failed") {
          await store.jobs.restart(message.groupId, id);
        }
      }

      if (job.kind === "asset" && "assetId" in job.payload) {
        const asset = await store.asset(job.payload.assetId);
        const canParse =
          (asset.kind === "image" && Boolean(config.AI_VISION_MODEL)) ||
          (asset.kind === "audio" && Boolean(config.AI_AUDIO_MODEL));

        // 之前未配置识别模型时，完成的任务可能只保存了文件。
        if (job.state === "done" && !asset.interpretation && canParse) {
          await store.jobs.restart(message.groupId, id);
        }
      }

      const waiting = store.jobs.wait(
        message.groupId,
        id,
        config.AI_TIMEOUT_MS + 70_000,
        signal,
      );

      processPending();
      await waiting;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(await store.taskStatus(message.groupId, id)),
        },
      ],
      details: {},
    };
  },
});
