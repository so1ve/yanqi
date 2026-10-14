import { readDataFile as readStoredFile } from "@yanqi/bot";
import { createError } from "h3";

import { storeOperation } from "./utils/http";

export async function readDataFile(
  directory: string,
  path: string,
): Promise<Buffer> {
  try {
    return await storeOperation(() => readStoredFile(directory, path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw createError({
        statusCode: 410,
        message: "文件已清理或不存在，原消息和纪要仍然保留",
      });
    }

    throw error;
  }
}
