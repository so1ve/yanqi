import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import { createError } from "h3";

export function imageMimeType(path: string): string | undefined {
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };

  return types[extname(path).toLowerCase()];
}

export function readDataFile(directory: string, path: string): Promise<Buffer> {
  const target = resolve(path);

  if (!target.startsWith(`${resolve(directory)}${sep}`)) {
    throw createError({ statusCode: 400, message: "文件不在当前数据目录中" });
  }

  return readFile(target);
}
