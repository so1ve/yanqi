import { sourceBoundary } from "./common.ts";

export const compactionPrompt = (maxChars: number) => `${sourceBoundary}
压缩本群之前的对话，供同一会话继续使用。保留当前主题、发言人及 QQ 号、明确要求、已作决定、尚未解决的问题，以及继续工作必需的纪要或持久任务 ID。
分清请求、计划、工具已执行的结果和失败；不能把承诺写成完成。不复制长篇原文、工具 JSON、临时 subagent ID 或查阅句柄，也不从对话猜测长期偏好。旧摘要与新对话合并去重，过时状态按后续结果更正。
只返回 summary，控制在 ${maxChars} 字符内。`;
