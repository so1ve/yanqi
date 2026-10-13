import { fileURLToPath } from "node:url";

import sqlitePackage from "@koishijs/plugin-database-sqlite/package.json" with { type: "json" };
import { defineNuxtConfig } from "nuxt/config";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-10-13",
  ssr: false,
  devtools: { enabled: false },
  css: ["~/assets/main.css"],
  vite: {
    optimizeDeps: {
      include: ["naive-ui", "@vicons/tabler", "dompurify", "marked"],
    },
    plugins: [
      Components({ dirs: [], dts: false, resolvers: [NaiveUiResolver()] }),
    ],
  },
  nitro: {
    preset: "node-server",
    esbuild: { options: { target: "node24" } },
    // SQLite 的 ESM 入口直接导出驱动类。
    alias: {
      "@koishijs/plugin-database-sqlite": fileURLToPath(
        new URL(
          sqlitePackage.module,
          import.meta.resolve("@koishijs/plugin-database-sqlite/package.json"),
        ),
      ),
    },
    externals: {
      // Core 与 SQLite 都使用 ESM，避免加载两份 Minato 导致数据转换互相等待。
      inline: ["@yanqi/bot", "@koishijs/core"],
      traceInclude: [
        fileURLToPath(
          import.meta.resolve("@minatojs/sql.js/dist/sql-wasm.wasm"),
        ),
      ],
    },
  },
  app: {
    head: {
      title: "言栖 · 管理台",
      htmlAttrs: { lang: "zh-CN" },
      meta: [{ name: "theme-color", content: "#f5f7fa" }],
    },
  },
});
