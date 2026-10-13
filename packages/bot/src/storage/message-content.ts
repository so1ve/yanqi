import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

import type { Segment } from "../types.ts";

type CompactSegment = [type: string, data: Record<string, unknown>];

export function encodeContent(segments: Segment[]): Uint8Array {
  const content: CompactSegment[] = segments.map(({ type, data }) => [
    type,
    data,
  ]);
  const compressed = brotliCompressSync(JSON.stringify(content), {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 4,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    },
  });

  return compressed;
}

export function decodeContent(buffer: Uint8Array): Segment[] {
  const content: CompactSegment[] = JSON.parse(
    brotliDecompressSync(Buffer.from(buffer)).toString("utf8"),
  );

  return content.map(([type, data]) => ({ type, data }));
}
