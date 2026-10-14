export const kindNames: Record<string, string> = {
  intent: "处理请求",
  observe: "识别请求",
  memory: "更新记忆",
  detect: "识别讨论",
  summarize: "整理纪要",
  publish: "统一交付纪要",
  asset: "解析附件",
  text: "文字回复",
  note: "纪要全文",
};

export const stateNames: Record<string, string> = {
  pending: "等待处理",
  running: "正在处理",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
