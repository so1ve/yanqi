import { Type } from "typebox";

import { waitForAsset } from "../../tasks/assets.ts";
import { taskStatus } from "../../tasks/status.ts";
import type { ToolContext } from "./context.ts";
import { object, tool } from "./context.ts";

const parameters = Type.Union([
  object({ action: Type.Literal("status") }),
  object({ action: Type.Literal("retry_failed") }),
  object({
    action: Type.Union([
      Type.Literal("inspect"),
      Type.Literal("wait"),
      Type.Literal("retry"),
    ]),
    id: Type.Integer({
      minimum: 1,
      description: "附件上下文、记录或查询工具返回的任务 ID",
    }),
  }),
]);

export function taskTool(context: ToolContext) {
  const { store, message, config, wake } = context;

  return tool(
    context,
    "task",
    "查询或等待本群后台任务。inspect 查指定 ID，status 查总体状态和近期纪要，适合催办。wait 仅用于后续答复或操作依赖结果时，等到完成、失败、取消或延后重试才返回，不定时唤醒。retry 重试指定失败任务，retry_failed 重试本群失败后台任务和发送。纪要重试成功交给后台后程序直接结束主对话，全部处理完再统一交付。对话请求不可重试或等待；其失败不代表纪要失败。延后重试时说明原因和时间后结束，不循环查询。",
    parameters,
    async (args, signal) => {
      if (args.action === "status") {
        return {
          ...(await store.groups.statistics(message.groupId)),
          tasks: await Promise.all(
            (await store.jobs.forGroup(message.groupId)).map((task) =>
              taskStatus(store, message.groupId, task.id),
            ),
          ),
        };
      }

      if (args.action === "retry_failed") {
        const jobs = await store.jobs.retryFailed(message.groupId, message.id);
        const deliveries = await store.deliveries.retryFailed(message.groupId);

        wake();

        return { restartedTasks: jobs, restartedDeliveries: deliveries };
      }

      const { id, action } = args;
      const job = await store.jobs.get(message.groupId, id);

      if (action !== "inspect") {
        if (job.kind === "intent" || job.kind === "observe") {
          throw new Error(
            "不能等待或重试对话请求，请指定相关附件或纪要的任务 ID",
          );
        }

        if (job.kind === "publish" && action === "wait") {
          throw new Error("批量交付由后台执行，无需等待；查询进度用 inspect");
        }

        if (action === "retry" && job.state === "failed") {
          const taskId = await store.jobs.restart(
            message.groupId,
            id,
            message.id,
          );

          if (job.kind === "summarize" || job.kind === "publish") {
            wake();

            return {
              taskId,
              state: "queued",
              delivery: "已交给后台，全部整理完成后统一交付。",
            };
          }
        }

        if (job.kind === "asset" && "assetId" in job.payload) {
          const asset = await store.assets.get(job.payload.assetId);
          const canParse =
            (asset.kind === "image" && Boolean(config.AI_VISION_MODEL)) ||
            (asset.kind === "audio" && Boolean(config.AI_AUDIO_MODEL));

          // 之前未配置模型时，附件任务可能只保存了文件。
          if (job.state === "done" && !asset.interpretation && canParse) {
            await store.jobs.restart(message.groupId, id);
          }

          if (action === "retry" && asset.kind === "forward") {
            for (const child of await store.assets.inForward(asset)) {
              const task = await store.jobs.forAsset(child.id);

              if (task.state === "failed") {
                await store.jobs.restart(message.groupId, task.id);
              }
            }
          }
        }

        const waiting =
          job.kind === "asset" && "assetId" in job.payload
            ? waitForAsset(store, message.groupId, job.payload.assetId, signal)
            : store.jobs.wait(message.groupId, id, signal);

        wake();
        await waiting;
      }

      return taskStatus(store, message.groupId, id);
    },
  );
}
