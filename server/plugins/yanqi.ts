import { resolve } from "node:path";

import { Logger } from "@koishijs/core";
import { Yanqi } from "@yanqi/bot";

import { Auth } from "../utils/auth";
import { ControlStore } from "../utils/control";
import { LogBuffer } from "../utils/logs";

const directory = resolve("data");
const control = await ControlStore.open(directory);
const saved = await control.settings();
const bot = await Yanqi.open(saved.config, directory);
const logs = new LogBuffer(() => bot.config);
const auth = await Auth.open(control);

if (saved.autostart) {
  try {
    await bot.start();
  } catch (error) {
    new Logger("yanqi:web").warn("自动启动失败：%s", String(error));
  }
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("request", (event) => {
    Object.assign(event.context, { bot, control, auth, logs });
  });
  nitro.hooks.hook("close", async () => {
    await bot.close();
    await control.close();
  });
});
