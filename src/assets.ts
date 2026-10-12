import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import type { Ai } from "./agent/models.ts";
import type { Config } from "./config.ts";
import type { Messenger } from "./onebot/messenger.ts";
import type { Store } from "./storage/store.ts";
import { failureMessage } from "./utils/errors.ts";

export async function collectAsset(
  id: number,
  store: Store,
  config: Config,
  ai: Ai,
  messenger: Messenger,
  reportProgress: (progress: string) => Promise<void>,
): Promise<void> {
  const asset = await store.asset(id);
  const message = await store.message(asset.messageId);
  const directory = join(store.directory, "groups", message.groupId, "assets");

  await mkdir(directory, { recursive: true });
  let path = asset.path;
  let mime = "application/octet-stream";

  try {
    if (asset.kind === "forward") {
      await reportProgress(`正在读取合并转发，附件 #${id}`);
      const forwarded = await messenger.getForward(asset.reference);
      const target = join(directory, `${id}.json`);
      const temporary = `${target}.${randomUUID()}.part`;

      await writeFile(temporary, JSON.stringify(forwarded, null, 2), {
        mode: 0o600,
      });
      await rename(temporary, target);
      path = target;
      await store.saveAsset(id, "saved", path, JSON.stringify(forwarded), null);
      await reportProgress("合并转发内容已保存");

      return;
    }

    if (!path) {
      await reportProgress(`正在下载${asset.kind}附件 #${id}`);
      const url = /^https?:\/\//i.test(asset.reference)
        ? asset.reference
        : await messenger.getAsset(
            message.groupId,
            asset.kind,
            asset.reference,
          );
      const response = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok || !response.body) {
        throw new Error(`附件下载失败（HTTP ${response.status}）`);
      }

      if (
        Number(response.headers.get("content-length")) >
        config.MAX_ATTACHMENT_BYTES
      ) {
        await response.body.cancel();

        throw new Error("附件超过配置的大小限制，未下载");
      }

      mime =
        response.headers.get("content-type")?.split(";")[0] ??
        "application/octet-stream";
      const suffix =
        (
          {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/webp": ".webp",
            "image/gif": ".gif",
            "audio/wav": ".wav",
            "audio/x-wav": ".wav",
            "audio/mpeg": ".mp3",
            "audio/ogg": ".ogg",
            "video/mp4": ".mp4",
            "application/pdf": ".pdf",
          } as Record<string, string>
        )[mime] ?? ".bin";
      const target = join(directory, `${id}${suffix}`);
      const temporary = `${target}.${randomUUID()}.part`;

      try {
        await pipeline(
          response.body,
          async function* (chunks) {
            let size = 0;

            for await (const chunk of chunks) {
              size += chunk.byteLength;
              if (size > config.MAX_ATTACHMENT_BYTES) {
                throw new Error("附件超过配置的大小限制，下载已停止");
              }

              yield chunk;
            }
          },
          createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
        );
        await rename(temporary, target);
        path = target;
      } catch (error) {
        await rm(temporary, { force: true });

        throw error;
      }

      await store.saveAsset(id, "saved", path, null, null);
    }

    if (asset.kind === "image" && config.AI_VISION_MODEL) {
      await reportProgress(`正在识图，模型 ${config.AI_VISION_MODEL.model}`);
      if (!mime.startsWith("image/")) {
        const extension = path.split(".").at(-1);

        mime = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
      }

      await store.saveAsset(
        id,
        "saved",
        path,
        await ai.understandImage(path, mime),
        null,
      );
      await reportProgress("图片识别完成，结果已保存");
    } else if (asset.kind === "audio" && config.AI_AUDIO_MODEL) {
      await reportProgress(`正在转写语音，模型 ${config.AI_AUDIO_MODEL.model}`);
      await store.saveAsset(id, "saved", path, await ai.transcribe(path), null);
      await reportProgress("语音转写完成，结果已保存");
    } else {
      await reportProgress(
        asset.kind === "image" || asset.kind === "audio"
          ? "文件已保存；未配置对应模型，未解析内容"
          : "附件文件已保存，不支持解析此文件类型",
      );
    }
  } catch (error) {
    await store.saveAsset(
      id,
      path ? "saved" : "failed",
      path,
      asset.interpretation,
      failureMessage(error),
    );

    throw error;
  }
}
