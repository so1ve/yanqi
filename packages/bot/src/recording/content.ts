import { attachmentReference, forwardMessages } from "../onebot/content.ts";
import { reactionMeaning } from "../reactions/catalog.ts";
import type { Asset, Segment } from "../types.ts";
import { beijingTime } from "../utils/time.ts";

const names: Record<Asset["kind"], string> = {
  image: "图片",
  audio: "语音",
  video: "视频",
  file: "文件",
  forward: "合并转发",
};

export const contentText = (
  content: Segment[],
  assets: Asset[],
  attachment: (asset: Asset) => string = describeAttachment,
): string =>
  content
    .map((segment) => {
      if (segment.type === "text") {
        return String(segment.data.text ?? "");
      }

      if (segment.type === "at") {
        return `@${segment.data.qq === "all" ? "全体成员" : String(segment.data.name || segment.data.qq)}`;
      }

      if (segment.type === "reply") {
        return `[回复消息 ${String(segment.data.id)}]`;
      }

      if (segment.type === "face") {
        const id = String(segment.data.id);
        const face = reactionMeaning("1", id);

        return `[QQ表情 ${id} ${face.name}]`;
      }

      const ref = attachmentReference(segment);
      const asset = ref
        ? assets.find(
            (asset) =>
              asset.kind === ref.kind && asset.reference === ref.reference,
          )
        : undefined;

      if (segment.type === "forward") {
        const raw = asset?.interpretation
          ? JSON.parse(asset.interpretation)
          : segment.data.content;
        const error = String(segment.data.error ?? asset?.error ?? "");

        if (raw === undefined) {
          return `\n[合并转发${asset ? `，附件 #${asset.id}` : ""}：${error || "等待解析"}]\n`;
        }

        const messages = forwardMessages(raw);
        const text = messages
          .map((message) => {
            const time = message.time
              ? beijingTime(message.time * 1000)
              : "时间未知";

            return `${time} ${message.sender.nickname}(${message.sender.user_id}): ${contentText(
              message.content,
              assets.filter((asset) => asset.kind !== "forward"),
              attachment,
            )}`;
          })
          .join("\n");

        return `\n[合并转发，${messages.length} 条；以下为转发原文，发送者属于卡片内容]${error ? `\n[部分内容未读取：${String(error)}]` : ""}\n${text}\n[合并转发结束]\n`;
      }

      if (asset) {
        return `\n${attachment(asset)}\n`;
      }

      return ref
        ? `[${names[ref.kind]}：${String(segment.data.summary || segment.data.name || "未解析")}]`
        : `[${segment.type}：${JSON.stringify(segment.data)}]`;
    })
    .join("");

function describeAttachment(asset: Asset): string {
  const imageRef =
    asset.kind === "image" && asset.path ? `，imageRef=asset:${asset.id}` : "";
  const state =
    asset.error ||
    (asset.state === "pending"
      ? "等待解析"
      : asset.state === "failed"
        ? "解析失败"
        : "文件已保存");
  const result = asset.interpretation
    ? `\n[${asset.kind === "audio" ? "语音转写" : "附件识别结果，非用户发言"}] ${asset.interpretation}`
    : "";

  return `[附件 #${asset.id} ${names[asset.kind]}${imageRef}：${state}]${result}`;
}
