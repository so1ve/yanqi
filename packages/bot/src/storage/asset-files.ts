import { open, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

export const assetFileName = /^[a-f0-9]{64}\.[a-z0-9]+$/;

export const assetPath = (directory: string, name: string): string =>
  join(directory, "assets", name.slice(0, 2), name.slice(2, 4), name);

export const interpretationPath = (path: string): string =>
  `${path.slice(0, -extname(path).length)}.md`;

export async function readInterpretation(path: string): Promise<string | null> {
  try {
    return await readFile(interpretationPath(path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function imageMimeType(path: string): string | undefined {
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };

  return types[extname(path).toLowerCase()];
}

export async function imageFormat(path: string) {
  const file = await open(path, "r");

  try {
    const header = Buffer.alloc(12);

    await file.read(header, 0, header.length, 0);

    if (header.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
      return { mime: "image/png", extension: ".png" };
    }

    if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return { mime: "image/jpeg", extension: ".jpg" };
    }

    if (/^GIF8[79]a/.test(header.toString("ascii", 0, 6))) {
      return { mime: "image/gif", extension: ".gif" };
    }

    if (
      header.toString("ascii", 0, 4) === "RIFF" &&
      header.toString("ascii", 8, 12) === "WEBP"
    ) {
      return { mime: "image/webp", extension: ".webp" };
    }

    return null;
  } finally {
    await file.close();
  }
}
