import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

import type { Ai } from "./agent/ai.ts";
import type { Config } from "./config.ts";
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
): Promise<void> {
  const asset = await store.assets.get(id);
  const message = await store.messages.get(asset.messageId);
  const directory = join(store.directory, "assets");

  await mkdir(directory, { recursive: true });
  let path = asset.path;

  try {
    if (asset.kind === "forward") {
      await reportProgress(`正在读取合并转发，附件 #${id}`);
      const forwarded = await messenger.getForward(asset.reference);
      const content = JSON.stringify(forwarded);
      const hash = createHash("sha256").update(content).digest("hex");
      const target = assetPath(store.directory, `${hash}.json`);
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
      await store.assets.save(id, "saved", path, content, null);
      await reportProgress("合并转发内容已保存");

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
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
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
        const format =
          asset.kind === "image" ? await imageFormat(temporary) : null;
        const target = assetPath(
          store.directory,
          `${hash.digest("hex")}${format?.extension ?? suffix}`,
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

    if (asset.kind === "image" && config.AI_VISION_MODEL) {
      await reportProgress(
        `正在识别图片，模型 ${config.AI_VISION_MODEL.model}`,
      );
      await store.assets.save(
        id,
        "saved",
        path,
        await store.assets.interpret(savedPath, async () => {
          const format = await imageFormat(savedPath);

          if (!format) {
            throw new Error("暂不支持这种图片格式。原图已保存");
          }

          return ai.media.understandImage(savedPath, format.mime);
        }),
        null,
      );
      await reportProgress("图片识别完成，结果已保存");
    } else if (asset.kind === "audio" && config.AI_AUDIO_MODEL) {
      await reportProgress(`正在转写语音，模型 ${config.AI_AUDIO_MODEL.model}`);
      await store.assets.save(
        id,
        "saved",
        path,
        await store.assets.interpret(savedPath, () =>
          ai.media.transcribe(savedPath),
        ),
        null,
      );
      await reportProgress("语音转写完成，结果已保存");
    } else {
      await reportProgress(
        asset.kind === "image" || asset.kind === "audio"
          ? "文件已保存。请配置对应模型后解析内容"
          : "文件已保存。暂不支持解析此类文件",
      );
    }
  } catch (error) {
    await store.assets.save(
      id,
      path ? "saved" : "failed",
      path,
      asset.interpretation,
      failureMessage(error),
    );

    throw error;
  }
}
