import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { Topic } from "../types.ts";
import { StoreError } from "./errors.ts";

export function readDataFile(directory: string, path: string): Promise<Buffer> {
  const target = resolve(path);

  if (!target.startsWith(`${resolve(directory)}${sep}`)) {
    throw new StoreError("invalid", "文件不在当前数据目录中");
  }

  return readFile(target);
}

export const topicDirectory = (
  root: string,
  topic: Pick<Topic, "groupId" | "id">,
): string => join(root, "groups", topic.groupId, "topics", topic.id);

export async function writeMarkdown(
  path: string,
  content: string,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.part`;

  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}
