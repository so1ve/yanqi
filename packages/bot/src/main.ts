import { Yanqi } from "./app.ts";
import { readConfig } from "./config.ts";
import { failureMessage } from "./utils/errors.ts";

async function main(): Promise<void> {
  const bot = await Yanqi.open(readConfig());

  await bot.start();
  process.once("SIGTERM", () => {
    void bot.close();
  });
  process.once("SIGINT", () => {
    void bot.close();
  });
}

main().catch((error) => {
  console.error(failureMessage(error));
  process.exit(1);
});
