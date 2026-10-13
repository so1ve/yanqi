import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Topic } from "../types.ts";

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
