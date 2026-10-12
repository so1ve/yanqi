import { defineNuxtConfig } from "nuxt/config";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-10-13",
  ssr: false,
  devtools: { enabled: false },
  css: ["~/assets/main.css"],
  vite: {
    plugins: [
      Components({ dirs: [], dts: false, resolvers: [NaiveUiResolver()] }),
    ],
  },
  nitro: {
    devProxy: {
      "/api": {
        target: process.env.API_PROXY ?? "http://127.0.0.1:3100/api",
        changeOrigin: false,
      },
    },
  },
  app: {
    head: {
      title: "言栖 · 记录工作台",
      htmlAttrs: { lang: "zh-CN" },
      meta: [{ name: "theme-color", content: "#f5f7fa" }],
    },
  },
});
