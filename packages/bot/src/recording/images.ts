import { relative, sep } from "node:path";

import { marked } from "marked";

import type { Asset } from "../types.ts";

// 模型只选择原文中提供的图片 ID，磁盘路径由程序生成。
export function noteImages(
  markdown: string,
  images: Asset[],
  directory: string,
): string {
  let result = markdown;

  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (token.type !== "image") {
      return;
    }

    const match = /^asset:(\d+)$/.exec(token.href);
    const asset = match
      ? images.find((image) => image.id === Number(match[1]))
      : undefined;

    if (!asset?.path) {
      throw new Error(`纪要引用了原文范围外或尚未保存的图片：${token.href}`);
    }

    const path = relative(directory, asset.path).split(sep).join("/");
    const alt = token.text
      .replaceAll("\\", "\\\\")
      .replaceAll("[", "\\[")
      .replaceAll("]", "\\]");

    result = result.replaceAll(token.raw, `![${alt}](<${path}>)`);
  });

  return result;
}
