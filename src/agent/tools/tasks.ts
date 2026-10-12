import { Type } from "typebox";

import { taskStatus } from "../../tasks/status.ts";
import type { ToolContext } from "./context.ts";
import { object, requireAdmin, tool } from "./context.ts";

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
    "inspect 查看任务详情；wait 等待完成并读取最新结果；retry 重试指定失败任务并等待。问图片内容先等待对应任务。附件可直接重试，其他重试需管理员。status 查本群总体状态；retry_failed 重试本群失败的后台和发送任务，需管理员。对话不会从头重跑。",
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
        requireAdmin(context);
        const jobs = await store.jobs.retryFailed(message.groupId);
        const deliveries = await store.deliveries.retryFailed(message.groupId);

        wake();

        return { restartedTasks: jobs, restartedDeliveries: deliveries };
      }

      const { id, action } = args;
      const job = await store.jobs.get(message.groupId, id);

      if (action !== "inspect") {
        if (job.kind === "intent") {
          throw new Error(
            "对话不能从头重跑或相互等待，请查询它依赖的附件或纪要任务",
          );
        }

        if (action === "retry") {
          if (job.kind !== "asset") {
            requireAdmin(context);
          }

          if (job.state === "failed") {
            await store.jobs.restart(message.groupId, id);
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
        }

        const waiting = store.jobs.wait(
          message.groupId,
          id,
          config.AI_TIMEOUT_MS + 70_000,
          signal,
        );

        wake();
        await waiting;
      }

      return taskStatus(store, message.groupId, id);
    },
  );
}
