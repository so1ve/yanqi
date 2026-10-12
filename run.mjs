import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import sqlitePackage from "@koishijs/plugin-database-sqlite/package.json" with { type: "json" };
import { unrun } from "unrun";

const require = createRequire(import.meta.url);

// Koishi 的 ESM loader 无法启动；SQLite 则需要 ESM 入口才能直接导入驱动类。
const entries = new Map([
  [
    "@koishijs/plugin-database-sqlite",
    new URL(
      sqlitePackage.module,
      import.meta.resolve("@koishijs/plugin-database-sqlite/package.json"),
    ).href,
  ],
  ["koishi", pathToFileURL(require.resolve("koishi")).href],
]);

await unrun({
  path: new URL("./src/main.ts", import.meta.url),
  inputOptions: {
    external: (id) =>
      !entries.has(id) &&
      !id.startsWith(".") &&
      !isAbsolute(id) &&
      !id.startsWith("\0"),
    plugins: [
      {
        name: "koishi-entries",
        resolveId(id) {
          const entry = entries.get(id);

          if (entry) {
            return { id: entry, external: true };
          }
        },
      },
    ],
  },
});
