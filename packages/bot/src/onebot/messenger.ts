import { readFile } from "node:fs/promises";

import type { Bot, Context } from "@koishijs/core";
import { Logger, h } from "@koishijs/core";
import type { OneBot } from "koishi-plugin-adapter-onebot";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { Asset, Message, Note, Segment } from "../types.ts";
import { failureMessage } from "../utils/errors.ts";
import { logDetail } from "../utils/logging.ts";
import { renderQQ, renderQQParts } from "./render.ts";

type ProtocolBot = Bot & { internal: OneBot.Internal };

function textParts(text: string, length: number): string[] {
  const chars = [...text];
  const result: string[] = [];
  let position = 0;

  while (position < chars.length) {
    const chunk = chars.slice(position, position + length);
    const newline = chunk.lastIndexOf("\n");
    const size =
      position + length < chars.length && newline !== -1
        ? newline + 1
        : chunk.length;

    result.push(chunk.slice(0, size).join(""));
    position += size;
  }

  return result;
}

export function createMessenger(config: Config, store: Store, ctx: Context) {
  const logger = new Logger("yanqi:qq");

  function getBot(): ProtocolBot {
    const bot = ctx.bots.find(
      (candidate) => candidate.selfId === config.BOT_QQ,
    );

    // Satori ONLINE is 1; Koishi's isActive also includes CONNECT.
    if (bot?.status !== 1) {
      throw new Error("QQ 账号尚未连接");
    }

    return bot as ProtocolBot;
  }

  async function saveOutgoing(
    groupId: string,
    messageId: string,
    text: string,
    segments: Segment[],
    noteId?: number,
  ) {
    const now = Date.now();

    await store.inbox.capture({
      groupId,
      messageId,
      userId: config.BOT_QQ,
      displayName: "言栖",
      sentAt: now,
      receivedAt: now,
      text,
      content: segments,
      replyTo: null,
      isBot: true,
      addressed: false,
      role: "member",
      ...(noteId === undefined ? {} : { noteId }),
    });
  }

  return {
    get online(): boolean {
      return ctx.bots.find((bot) => bot.selfId === config.BOT_QQ)?.status === 1;
    },
    async acknowledge({
      id,
      groupId,
      messageId,
    }: Pick<Message, "id" | "groupId" | "messageId">) {
      if (!config.ACK_EMOJI_ID) {
        return;
      }

      try {
        await getBot().createReaction(groupId, messageId, config.ACK_EMOJI_ID);
      } catch (error) {
        logger.warn(
          "处理标记失败：m%s group=%s %s",
          id,
          groupId,
          logDetail(failureMessage(error), config),
        );
      }
    },
    async sendText(groupId: string, text: string) {
      text = renderQQ(text);

      if (!text.trim()) {
        return;
      }

      const segments = [{ type: "text", data: { text } }];
      const ids = await getBot().sendMessage(groupId, h.text(text));

      for (const id of ids) {
        await saveOutgoing(groupId, id, text, segments);
      }
    },
    async sendNote(note: Note) {
      const bot = getBot();
      const contents: Segment[][] = [];

      for (const part of renderQQParts(note.markdown)) {
        if (part.kind === "text") {
          contents.push(
            ...textParts(part.text, 1800).map((text) => [
              { type: "text", data: { text } },
            ]),
          );

          continue;
        }

        const match =
          /^(?:\.\.\/)+assets\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-f0-9]{64}\.[a-z0-9]+)$/.exec(
            part.href,
          );
        const asset = match
          ? await store.assets.file(note.groupId, match[1]!)
          : undefined;

        if (!asset?.path || asset.kind !== "image") {
          throw new Error(`纪要图片不属于当前群或尚未保存：${part.href}`);
        }

        // NapCat 使用独立容器，通过文件内容传图，不传机器人容器内的路径。
        contents.push([
          {
            type: "image",
            data: {
              file: `base64://${(await readFile(asset.path)).toString("base64")}`,
            },
          },
          ...(part.text ? [{ type: "text", data: { text: part.text } }] : []),
        ]);
      }

      const nodes = contents.map((content) => ({
        type: "node",
        data: {
          user_id: config.BOT_QQ,
          nickname: "言栖",
          content,
        },
      }));

      // The universal encoder trims node whitespace; preserve code with the adapter's native API.
      for (let position = 0; position < nodes.length; position += 50) {
        const part = nodes.slice(position, position + 50);
        const id = await bot.internal.sendGroupForwardMsg(note.groupId, part);

        await saveOutgoing(
          note.groupId,
          String(id),
          part
            .flatMap((node) =>
              node.data.content
                .filter((segment) => segment.type === "text")
                .map((segment) => String(segment.data.text)),
            )
            .join("\n"),
          [],
          note.id,
        );
      }
    },
    async getAsset(groupId: string, kind: Asset["kind"], reference: string) {
      const internal = getBot().internal;

      if (kind === "image") {
        const image = await internal.getImage(reference);

        return image.url || image.file;
      }

      if (kind === "audio") {
        return (await internal.getRecord(reference, "wav", true)).file;
      }

      if (kind === "file") {
        return internal.getGroupFileUrl(groupId, reference, 0);
      }

      throw new Error(`附件 ${kind} 未提供可下载地址`);
    },
    async refreshImageURL(reference: string): Promise<string | null> {
      const url = new URL(reference);
      const appid = url.searchParams.get("appid");

      // rkey 只能用于 QQ 的图片下载地址，不能交给消息里任意指定的主机。
      if (
        !["gchat.qpic.cn", "multimedia.nt.qq.com.cn"].includes(url.hostname) ||
        url.pathname !== "/download" ||
        (appid !== "1406" && appid !== "1407")
      ) {
        return null;
      }

      const keys: { type: number; rkey: string }[] =
        await getBot().internal._get("nc_get_rkey");
      const key = keys.find((key) => key.type === (appid === "1407" ? 20 : 10));
      const rkey = key && new URLSearchParams(key.rkey).get("rkey");

      if (!rkey) {
        throw new Error("NapCat 没有返回可用的图片下载凭据");
      }

      url.protocol = "https:";
      url.searchParams.set("rkey", rkey);

      return url.href;
    },
    getForward(reference: string) {
      return getBot().internal.getForwardMsg(reference);
    },
  };
}

export type Messenger = ReturnType<typeof createMessenger>;
