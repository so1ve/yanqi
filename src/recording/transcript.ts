import { relative, sep } from "node:path";

import type { Store } from "../storage/store.ts";
import type { Asset, Message } from "../types.ts";

const timeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  dateStyle: "short",
  timeStyle: "medium",
});

const assetNames: Record<Asset["kind"], string> = {
  image: "图片",
  audio: "语音",
  video: "视频",
  file: "文件",
  forward: "合并转发",
};

export async function transcript(
  store: Store,
  messages: Message[],
  directory: string,
): Promise<string> {
  const blocks: string[] = ["时间：北京时间（UTC+8）"];
  let previousTime = "";

  for (const message of messages) {
    const time = timeFormat.format(message.sentAt);

    if (time !== previousTime) {
      blocks.push(time);
      previousTime = time;
    }

    const sender = `${message.displayName} (${message.userId})`;
    const recalled =
      message.recalledAt === null
        ? ""
        : `[已于 ${timeFormat.format(message.recalledAt)} 撤回] `;
    const content = message.text.includes("\n")
      ? `${sender}：${recalled}\n\n${message.text}`
      : `${sender}：${recalled}${message.text}`;
    const details: string[] = [];

    if (message.replyTo) {
      details.push(`回复消息 ${message.replyTo}`);
    }

    const assets = await store.assets.forMessage(message.id);

    for (const asset of assets) {
      const name = assetNames[asset.kind];
      const link = asset.path
        ? `[${name}](<${relative(directory, asset.path).split(sep).join("/")}>)`
        : name;
      const state =
        asset.error ??
        (asset.state === "pending"
          ? "待保存"
          : asset.state === "failed"
            ? "保存失败"
            : "已保存");

      details.push(`${link}（${state}）`);
    }

    for (const segment of message.segments) {
      if (segment.type === "text" || segment.type === "reply") {
        continue;
      }

      const kind = segment.type === "record" ? "audio" : segment.type;

      if (assets.some((asset) => asset.kind === kind)) {
        continue;
      }

      if (segment.type === "at") {
        details.push(`@${String(segment.data.qq)}`);
      } else if (segment.type === "face") {
        details.push(`表情 ${String(segment.data.id)}`);
      } else {
        details.push(`${segment.type}：${JSON.stringify(segment.data)}`);
      }
    }

    blocks.push(
      `${content}${details.length > 0 ? `\n\n${details.join("；")}` : ""}`,
    );
  }

  return `${blocks.join("\n\n")}\n`;
}
