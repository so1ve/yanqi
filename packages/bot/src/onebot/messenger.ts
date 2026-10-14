import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import type { Bot, Context } from "@koishijs/core";
import { h } from "@koishijs/core";
import type { OneBot } from "koishi-plugin-adapter-onebot";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import type { Asset, Note, Segment } from "../types.ts";
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

// NapCat 的默认预览只会把嵌套转发写成“卡片消息”，用纪要标题和版本作目录。
const forwardPreview = (notes: { title: string; revision: number }[]) => ({
  source: "小栖纪要",
  news: notes.map(({ title, revision }) => ({
    text: `${title} · 第 ${revision} 版`,
  })),
  summary: notes.length === 1 ? "查看纪要" : `查看 ${notes.length} 份纪要`,
  prompt:
    notes.length === 1
      ? `[纪要] ${notes[0]!.title}`
      : `[纪要] ${notes.length} 个话题`,
});

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
    replyTo: string | null = null,
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
      replyTo,
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
    async sendText(
      groupId: string,
      text: string,
      replyTo: string | null = null,
    ) {
      text = renderQQ(text);

      if (!text.trim()) {
        return;
      }

      const segments = [
        ...(replyTo ? [{ type: "reply", data: { id: replyTo } }] : []),
        { type: "text", data: { text } },
      ];
      const ids = await getBot().sendMessage(groupId, [
        ...(replyTo ? [h.quote(replyTo)] : []),
        h.text(text),
      ]);

      for (const id of ids) {
        await saveOutgoing(groupId, id, text, segments, undefined, replyTo);
      }
    },
    async sendNotes(
      notes: Note[],
      notification = "",
      replyTo: string | null = null,
    ) {
      const bot = getBot();

      assert.ok(notes.length > 0);
      const groupId = notes[0]!.groupId;

      assert.ok(notes.every((note) => note.groupId === groupId));
      const documents: {
        title: string;
        revision: number;
        contents: Segment[][];
      }[] = [];

      for (const note of notes) {
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

        const topic = await store.topics.get(note.topicId);

        documents.push({
          title: topic.title,
          revision: note.revision,
          contents,
        });
      }

      const announcement = renderQQ(notification);
      const quote = replyTo ? [{ type: "reply", data: { id: replyTo } }] : [];

      // NapCat 的转发接口只接收 node；引用放在首条内容内，整批仍只发一张卡片。
      if (!announcement && quote.length > 0) {
        documents[0]!.contents[0]!.unshift(...quote);
      }

      const node = (content: Segment[]): Segment => ({
        type: "node",
        data: {
          user_id: config.BOT_QQ,
          nickname: "言栖",
          content,
        },
      });
      const nodes = documents.flatMap((document) => {
        const { contents } = document;
        const children = contents.map(node);

        // NapCat 把 node 内的 node 列表生成嵌套转发，无需先向群里发送子卡片。
        if (notes.length === 1) {
          return children;
        }

        const card = node(children);

        Object.assign(card.data, forwardPreview([document]));

        return [card];
      });

      if (announcement) {
        nodes.unshift(
          node([...quote, { type: "text", data: { text: announcement } }]),
        );
      }

      // 通用适配器未暴露预览字段；原生接口仍把整批纪要作为一条群消息发送。
      const { message_id: id } = await bot.internal._get(
        "send_group_forward_msg",
        {
          group_id: groupId,
          messages: nodes,
          ...forwardPreview(documents),
        },
      );

      await saveOutgoing(
        groupId,
        String(id),
        [
          ...(announcement ? [announcement] : []),
          ...documents
            .flatMap(({ contents }) => contents.flat())
            .filter((segment) => segment.type === "text")
            .map((segment) => String(segment.data.text)),
        ].join("\n"),
        [],
        notes.length === 1 ? notes[0]!.id : undefined,
        replyTo,
      );
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
