import { Type } from "typebox";

import { beijingDate } from "../../utils/time.ts";
import type { ToolContext } from "./context.ts";
import { object, requireAdmin, tool } from "./context.ts";

export function settingsTools(context: ToolContext) {
  const { store, message } = context;

  return [
    tool(
      context,
      "usage",
      "查询本群今天的 AI 调用次数和 token 用量，按提供商、配置项、模型、用途汇总。未上报不等于零，费用以提供商账单为准。",
      object({}),
      () => store.usage.summary(message.groupId, beijingDate(message.sentAt)),
    ),
    tool(
      context,
      "automatic",
      "开启或暂停本群自动整理，需要管理员权限。暂停后继续保存原文和处理对话请求。",
      object({ enabled: Type.Boolean() }),
      async ({ enabled }) => {
        requireAdmin(context);
        await store.groups.setAutomatic(message.groupId, enabled);

        return `已${enabled ? "开启" : "暂停"}本群自动整理。`;
      },
    ),
  ];
}
