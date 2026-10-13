import { Type } from "typebox";

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
    "inspect 查看指定任务；wait 最多等 30 秒并读取结果或已有进度，未完成可以继续等；retry 重试指定失败任务并等待。询问附件内容时先等对应任务。status 查看本群任务状态；retry_failed 重试本群失败的后台任务和发送。对话请求不能重试或等待。",
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
        const jobs = await store.jobs.retryFailed(message.groupId);
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

        if (action === "retry" && job.state === "failed") {
          await store.jobs.restart(message.groupId, id);
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
        }

        const waiting = store.jobs.wait(message.groupId, id, 30_000, signal);

        wake();
        await waiting;
      }

      return taskStatus(store, message.groupId, id);
    },
  );
}
