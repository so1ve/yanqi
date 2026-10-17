import type { Asset } from "@yanqi/bot";

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

export const assetKindNames: Record<Asset["kind"], string> = {
  image: "图片",
  audio: "语音",
  video: "视频",
  file: "文件",
  forward: "合并转发",
};
