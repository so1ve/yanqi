import type { Bot, Context } from "koishi";
import { h } from "koishi";
import type { OneBot } from "koishi-plugin-adapter-onebot";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { Asset, Note, Segment } from "../types.ts";
import { renderQQ } from "./render.ts";

type ProtocolBot = Bot & { internal: OneBot.Internal };

function textParts(text: string, length: number): string[] {
  const chars = [...text];
  const result: string[] = [];
  let position = 0;

  while (position < chars.length) {
    const chunk = chars.slice(position, position + length);
    const newline = chunk.lastIndexOf("\n");
    const size =
      position + length < chars.length && newline >= 0
        ? newline + 1
        : chunk.length;

    result.push(chunk.slice(0, size).join(""));
    position += size;
  }

  return result;
}

export function createMessenger(config: Config, store: Store, ctx: Context) {
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

    await store.messages.capture({
      groupId,
      messageId,
      userId: config.BOT_QQ,
      displayName: "言栖",
      sentAt: now,
      receivedAt: now,
      text,
      segments,
      raw: { source: "yanqi-send", messageId, segments },
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
    async acknowledge(groupId: string, messageId: string) {
      if (config.ACK_EMOJI_ID) {
        await getBot().createReaction(groupId, messageId, config.ACK_EMOJI_ID);
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
      const chunks = textParts(renderQQ(note.markdown), 1800);
      const nodes = chunks.map((text) => ({
        type: "node",
        data: {
          user_id: config.BOT_QQ,
          nickname: "言栖",
          content: [{ type: "text", data: { text } }],
        },
      }));

      // The universal encoder trims node whitespace; preserve code with the adapter's native API.
      for (let position = 0; position < nodes.length; position += 50) {
        const part = nodes.slice(position, position + 50);
        const id = await bot.internal.sendGroupForwardMsg(note.groupId, part);

        await saveOutgoing(
          note.groupId,
          String(id),
          part.map((node) => node.data.content[0]!.data.text).join(""),
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
    getForward(reference: string) {
      return getBot().internal.getForwardMsg(reference);
    },
  };
}

export type Messenger = ReturnType<typeof createMessenger>;
