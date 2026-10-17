import { fileURLToPath } from "node:url";

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
    externals: {
      inline: ["@yanqi/bot", "@koishijs/core"],
      // 解码器在运行时读取 WASM，依赖追踪无法自动发现这个文件。
      traceInclude: [
        fileURLToPath(
          new URL(
            "./packages/bot/node_modules/silk-wasm/lib/silk.wasm",
            import.meta.url,
          ),
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
