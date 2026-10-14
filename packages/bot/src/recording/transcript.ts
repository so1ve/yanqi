import { relative, sep } from "node:path";

import { imageMimeType } from "../storage/asset-files.ts";
import type { Store } from "../storage/store.ts";
import type { Asset, Message } from "../types.ts";
import { contentText } from "./content.ts";

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
    const assets = await store.assets.forMessage(message.id);
    const content =
      contentText(message.content, assets, (asset) => {
        const name = assetNames[asset.kind];
        const link =
          asset.path && asset.state !== "missing"
            ? `${imageMimeType(asset.path) ? "!" : ""}[${name}](<${relative(directory, asset.path).split(sep).join("/")}>)`
            : name;
        const state =
          asset.error ??
          (asset.state === "missing"
            ? "原件已清理"
            : asset.state === "pending"
              ? "待保存"
              : asset.state === "failed"
                ? "保存失败"
                : "已保存");

        return `${link}（${state}）`;
      }) || message.text;

    blocks.push(`${sender}：${recalled}${content}`);
  }

  return `${blocks.join("\n\n")}\n`;
}
