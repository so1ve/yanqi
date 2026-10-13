import { resolve } from "node:path";

import { Yanqi } from "@yanqi/bot";

import { Auth } from "../auth";
import { AvatarCache } from "../avatars";
import { openDatabases } from "../database";
import { LogBuffer } from "../logs";
import { Settings } from "../settings";

const directory = resolve("data");
const { management, bot: database } = await openDatabases(directory);
const settings = new Settings(management);
const saved = await settings.load();

let bot: Yanqi;

const logs = new LogBuffer(() => bot?.config ?? saved.config);
const auth = await Auth.open(management);
const avatars = new AvatarCache(management);

bot = await Yanqi.open(saved.config, directory, database, saved.autostart);

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("request", (event) => {
    Object.assign(event.context, { bot, settings, auth, logs, avatars });
  });

  nitro.hooks.hook("close", async () => {
    await bot.close();
    await database.destroy();
    await management.destroy();
  });
});
