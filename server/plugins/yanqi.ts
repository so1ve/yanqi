import { resolve } from "node:path";

import { Yanqi } from "@yanqi/bot";

import { Auth } from "../auth";
import { AvatarCache } from "../avatars";
import { LogBuffer } from "../logs";
import { Accounts } from "../storage/accounts";
import { Avatars } from "../storage/avatars";
import { openDatabases } from "../storage/database";
import { Settings } from "../storage/settings";

const directory = resolve("data");
const { management, bot: database } = await openDatabases(directory);
const settings = new Settings(management);
const saved = await settings.load();

let bot: Yanqi;

const logs = new LogBuffer(() => bot?.config ?? saved.config);
const auth = await Auth.open(new Accounts(management));
const avatars = new AvatarCache(new Avatars(management));

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
