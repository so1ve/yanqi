import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

import type { Ai } from "./agent/ai.ts";
import type { Config } from "./config.ts";
import {
  attachmentReference,
  expandForward,
  forwardAttachments,
} from "./onebot/content.ts";
import type { Messenger } from "./onebot/messenger.ts";
import { assetPath, imageFormat } from "./storage/asset-files.ts";
import type { Store } from "./storage/store.ts";
import { failureMessage } from "./utils/errors.ts";

export async function collectAsset(
  id: number,
  store: Store,
  config: Config,
  ai: Ai,
  messenger: Messenger,
  reportProgress: (progress: string) => Promise<void>,
  signal: AbortSignal,
  refresh = false,
): Promise<void> {
  const asset = await store.assets.get(id);
  const message = await store.messages.get(asset.messageId);
  let path = asset.state === "missing" ? null : asset.path;
  let interpretation = asset.interpretation;

  try {
    if (asset.kind === "forward") {
      await reportProgress(`正在读取合并转发，附件 #${id}`);
      const embedded = message.content.find(
        (segment) =>
          segment.type === "forward" &&
          attachmentReference(segment)?.reference === asset.reference,
      )?.data.content;
      const forwarded = await expandForward(
        asset.reference,
        interpretation ? JSON.parse(interpretation) : embedded,
        (reference) => messenger.getForward(reference),
        config.MAX_ATTACHMENT_BYTES,
        signal,
      );
      const content = JSON.stringify(forwarded.messages);
      const hash = createHash("sha256").update(content).digest("hex");
      const target = assetPath(store.directory, "forward", `${hash}.json`);
      const temporary = `${target}.${randomUUID()}.part`;

      try {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(temporary, content, { mode: 0o600 });
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });

        throw error;
      }

      path = target;
      interpretation = content;
      await store.assets.capture(
        message,
        forwardAttachments(forwarded.messages),
      );
      await store.assets.save(id, "saved", path, content, null);
      if (forwarded.errors.length > 0) {
        throw new Error(`部分嵌套转发读取失败：${forwarded.errors.join("；")}`);
      }

      await reportProgress("转发内容已展开，卡片内的附件已交给后台解析");

      return;
    }

    if (!path) {
      await reportProgress(`正在下载附件 #${id}（${asset.kind}）`);
      const url = /^https?:\/\//i.test(asset.reference)
        ? asset.reference
        : await messenger.getAsset(
            message.groupId,
            asset.kind,
            asset.reference,
          );
      const request = {
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      };
      let response = await fetch(url, request);

      if (asset.kind === "image" && [400, 401, 403].includes(response.status)) {
        await response.body?.cancel();
        const refreshed = await messenger.refreshImageURL(url);

        if (refreshed) {
          await reportProgress(`正在刷新图片地址并重试附件 #${id}`);
          response = await fetch(refreshed, request);
        }
      }

      if (!response.ok || !response.body) {
        await response.body?.cancel();

        throw new Error(`附件下载失败（HTTP ${response.status}）`);
      }

      if (
        Number(response.headers.get("content-length")) >
        config.MAX_ATTACHMENT_BYTES
      ) {
        await response.body.cancel();

        throw new Error("附件超过配置的大小限制，未下载");
      }

      const mime =
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
      const hash = createHash("sha256");
      const directory = join(store.directory, "assets", ".downloads");

      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `${randomUUID()}.part`);

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

              hash.update(chunk);
              yield chunk;
            }
          },
          createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
          { signal },
        );
        // QQ 的 file 表示发送方式；图片格式以文件内容为准。
        const format = await imageFormat(temporary);
        const target = assetPath(
          store.directory,
          format ? "image" : asset.kind,
          `${hash.digest("hex")}${format?.extension ?? (mime.startsWith("image/") ? ".bin" : suffix)}`,
        );

        await mkdir(dirname(target), { recursive: true });
        await rename(temporary, target);
        path = target;
      } catch (error) {
        await rm(temporary, { force: true });

        throw error;
      }

      await store.assets.save(id, "saved", path, null, null);
    }

    const savedPath = path;
    const format = await imageFormat(savedPath);

    if ((format || asset.kind === "image") && config.AI_VISION_MODEL) {
      await reportProgress(
        `正在识别图片，模型 ${config.AI_VISION_MODEL.model}`,
      );
      await store.assets.interpret(
        savedPath,
        async () => {
          if (!format) {
            throw new Error("暂不支持这种图片格式。原图已保存");
          }

          return ai.media.understandImage(savedPath, format.mime);
        },
        refresh,
      );
      await reportProgress("图片识别完成，结果已保存");
    } else if (asset.kind === "audio" && config.AI_AUDIO_MODEL) {
      await reportProgress(`正在转写语音，模型 ${config.AI_AUDIO_MODEL.model}`);
      await store.assets.interpret(
        savedPath,
        () => ai.media.transcribe(savedPath),
        refresh,
      );
      await reportProgress("语音转写完成，结果已保存");
    } else {
      await reportProgress(
        format || asset.kind === "image" || asset.kind === "audio"
          ? "文件已保存。请配置对应模型后解析内容"
          : "文件已保存。暂不支持解析此类文件",
      );
    }
  } catch (error) {
    await store.assets.save(
      id,
      path ? "saved" : asset.state === "missing" ? "missing" : "failed",
      path ?? asset.path,
      (await store.assets.get(id)).interpretation ?? interpretation,
      failureMessage(error),
    );

    throw error;
  }
}
