import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { decoder as createAmrDecoder } from "@audio/decode-amr";
import { decode, getDuration, isSilk, isWav } from "silk-wasm";

import { assetPath } from "./asset-files.ts";

export class AudioFormatError extends Error {}

function wave(pcm: Uint8Array, sampleRate: number): Buffer<ArrayBuffer> {
  // 两种解码器都输出单声道采样，统一保存为 16 位小端 PCM WAV。
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

async function decodeAmr(
  bytes: Uint8Array,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Buffer<ArrayBuffer>> {
  const decoder = await createAmrDecoder();
  const chunks: Buffer[] = [];
  let size = 44;
  let sampleRate = 0;

  try {
    // 分块检查解码后的大小，避免小文件展开成过大的 PCM 缓冲区。
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      signal.throwIfAborted();
      const decoded = decoder.decode(bytes.subarray(offset, offset + 4096));
      const samples = decoded.channelData[0];

      if (!samples?.length) {
        continue;
      }

      size += samples.length * 2;
      if (size > maximumBytes) {
        throw new AudioFormatError("语音解码后超过配置的大小限制，未转换");
      }

      sampleRate = decoded.sampleRate;
      const pcm = Buffer.alloc(samples.length * 2);

      for (const [index, sample_] of samples.entries()) {
        const sample = Math.max(-1, Math.min(1, sample_));

        pcm.writeInt16LE(
          Math.round(sample * (sample < 0 ? 32_768 : 32_767)),
          index * 2,
        );
      }

      chunks.push(pcm);
    }
  } finally {
    decoder.free();
  }

  if (chunks.length === 0) {
    throw new AudioFormatError("AMR 语音没有可解码的音频帧，原文件已保留");
  }

  return wave(Buffer.concat(chunks), sampleRate);
}

// QQ 语音可能使用 AMR 或 SILK；按文件内容解码，不能靠 MIME 或后缀判断。
export async function saveAudio(
  directory: string,
  source: string,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<string> {
  let bytes = await readFile(source, { signal });
  let extension: string;

  if (bytes.length > maximumBytes) {
    throw new AudioFormatError("语音超过配置的大小限制，未转换");
  }

  if (isSilk(bytes)) {
    const sampleRate = 24_000;
    const estimatedBytes = (getDuration(bytes) * sampleRate * 2) / 1000 + 44;

    if (estimatedBytes > maximumBytes) {
      throw new AudioFormatError("语音解码后超过配置的大小限制，未转换");
    }

    const pcm = await decode(bytes, sampleRate);

    signal.throwIfAborted();
    if (pcm.data.length + 44 > maximumBytes) {
      throw new AudioFormatError("语音解码后超过配置的大小限制，未保存");
    }

    bytes = wave(pcm.data, sampleRate);
    extension = ".wav";
  } else if (
    bytes.toString("ascii", 0, 6) === "#!AMR\n" ||
    bytes.toString("ascii", 0, 9) === "#!AMR-WB\n"
  ) {
    bytes = await decodeAmr(bytes, maximumBytes, signal);
    extension = ".wav";
  } else if (isWav(bytes)) {
    extension = ".wav";
  } else if (bytes.toString("ascii", 0, 4) === "OggS") {
    extension = ".ogg";
  } else if (
    bytes.toString("ascii", 0, 3) === "ID3" ||
    (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)
  ) {
    extension = ".mp3";
  } else {
    throw new AudioFormatError("语音格式不受支持或文件已损坏，原文件已保留");
  }

  const hash = createHash("sha256").update(bytes).digest("hex");
  const target = assetPath(directory, "audio", `${hash}${extension}`);
  const temporary = `${target}.${randomUUID()}.part`;

  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, bytes, { mode: 0o600, signal });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });

    throw error;
  }

  return target;
}
