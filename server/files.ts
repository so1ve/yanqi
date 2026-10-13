import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { createError } from "h3";

export function readDataFile(directory: string, path: string): Promise<Buffer> {
  const target = resolve(path);

  if (!target.startsWith(`${resolve(directory)}${sep}`)) {
    throw createError({ statusCode: 400, message: "文件不在当前数据目录中" });
  }

  return readFile(target);
}
