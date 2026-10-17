import { once } from "node:events";
import { dirname, join } from "node:path";
import { addAbortSignal } from "node:stream";

import type { Note, Store } from "@yanqi/bot";
import { readDataFile } from "@yanqi/bot";
import archiver from "archiver";
import { marked } from "marked";

// 只导出纪要和原文实际引用的资源，并通过群内资源查询限制读取范围。
const resourceLink =
  /^(?:\.\.\/)+assets\/(?:images|audio|video|files|forwards)\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-f0-9]{64}\.[a-z0-9]+)$/;

export function noteArchive(store: Store, note: Note, signal: AbortSignal) {
  const archive = archiver("zip", { zlib: { level: 6 } });

  addAbortSignal(signal, archive);

  async function append(name: string, content: string | Buffer) {
    signal.throwIfAborted();
    const written = once(archive, "entry", { signal });

    archive.append(content, { name });
    await written;
  }

  async function write() {
    let transcript: string;

    try {
      transcript = (
        await readDataFile(
          store.directory,
          join(dirname(note.path), "transcript.md"),
        )
      ).toString("utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      transcript = "# 完整原文\n\n原文文件已清理或不存在，纪要仍然保留。\n";
    }

    const documents = new Map([
      ["note.md", note.markdown],
      ["transcript.md", transcript],
    ]);
    const resources = new Map<string, string | null>();
    const included = new Set<string>();

    for (const markdown of documents.values()) {
      marked.walkTokens(marked.lexer(markdown), (token) => {
        if (
          (token.type === "image" || token.type === "link") &&
          resourceLink.test(token.href)
        ) {
          resources.set(token.href, null);
        }
      });
    }

    for (const href of resources.keys()) {
      signal.throwIfAborted();
      const name = resourceLink.exec(href)![1]!;
      const target = `resources/${name}`;

      if (included.has(target)) {
        resources.set(href, target);

        continue;
      }

      const asset = await store.assets.file(note.groupId, name);

      if (!asset?.path || asset.state === "missing") {
        continue;
      }

      let bytes: Buffer;

      try {
        bytes = await readDataFile(store.directory, asset.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }

        throw error;
      }

      // 每次写完一个资源再读取下一个，下载时不把整个压缩包留在内存中。
      await append(target, bytes);
      resources.set(href, target);
      included.add(target);
    }

    for (const [name, markdown] of documents) {
      let content = markdown;

      marked.walkTokens(marked.lexer(markdown), (token) => {
        if (
          (token.type !== "image" && token.type !== "link") ||
          !resources.has(token.href)
        ) {
          return;
        }

        const target = resources.get(token.href);
        const label = token.text || (token.type === "image" ? "图片" : "资源");
        const replacement = target
          ? `${token.type === "image" ? "!" : ""}[${label}](<${target}>)`
          : `[${label}：原件已清理或未保存]`;

        content = content.replaceAll(token.raw, replacement);
      });
      await append(name, content);
    }

    await archive.finalize();
  }

  void write().catch((error: Error) => archive.destroy(error));

  return archive;
}
