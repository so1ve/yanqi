// Koishi 的 ESM loader 无法启动，用 .cts 加载它的 CommonJS 入口。
export { default as SQLitePlugin } from "@koishijs/plugin-database-sqlite";
export { HTTP } from "@koishijs/plugin-http";
export { $, Adapter, App, h } from "koishi";
export { OneBotBot } from "koishi-plugin-adapter-onebot";
