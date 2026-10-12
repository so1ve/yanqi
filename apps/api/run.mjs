import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const entry = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]))
  : new URL("./src/main.ts", import.meta.url);

process.chdir(fileURLToPath(new URL("../..", import.meta.url)));

await unrun({
  path: entry,
  inputOptions: {
    external: (id) => id.startsWith("node:"),
    plugins: [
      {
        name: "koishi-entries",
        async resolveId(id, importer) {
          const entry = entries.get(id);

          if (entry) {
            return { id: entry, external: true };
          }

          if (
            !id.startsWith("@yanqi/") &&
            !id.startsWith(".") &&
            !isAbsolute(id) &&
            !id.startsWith("\0")
          ) {
            const resolved = await this.resolve(id, importer, {
              skipSelf: true,
            });

            if (resolved) {
              return { ...resolved, external: true };
            }
          }
        },
      },
    ],
  },
});
