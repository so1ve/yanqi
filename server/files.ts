import { readDataFile as readStoredFile } from "@yanqi/bot";

import { storeOperation } from "./utils/http";

export const readDataFile = (
  directory: string,
  path: string,
): Promise<Buffer> => storeOperation(() => readStoredFile(directory, path));
