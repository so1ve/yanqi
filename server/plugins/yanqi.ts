import { resolve } from "node:path";

import { Yanqi } from "@yanqi/bot";

import { Auth } from "../auth";
import { openDatabase } from "../database";
import { LogBuffer } from "../logs";
import { Settings } from "../settings";

const directory = resolve("data");
const db = await openDatabase(directory);
const settings = new Settings(db);
const saved = await settings.load();
let bot: Yanqi;
const logs = new LogBuffer(() => bot?.config ?? saved.config);
const auth = await Auth.open(db);

bot = await Yanqi.open(saved.config, directory, saved.autostart);

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("request", (event) => {
    Object.assign(event.context, { bot, settings, auth, logs });
  });
  nitro.hooks.hook("close", async () => {
    await bot.close();
    await db.destroy();
  });
});
