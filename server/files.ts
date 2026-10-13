import { extname } from "node:path";

import { readDataFile as readStoredFile } from "@yanqi/bot";

import { storeOperation } from "./utils/http";

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

export const readDataFile = (
  directory: string,
  path: string,
): Promise<Buffer> => storeOperation(() => readStoredFile(directory, path));
