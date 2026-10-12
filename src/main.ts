import { startApplication } from "./app.ts";
import { readConfig } from "./config.ts";
import { failureMessage } from "./utils/errors.ts";

async function main(): Promise<void> {
  await startApplication(readConfig());
}

main().catch((error) => {
  console.error(failureMessage(error));
  process.exit(1);
});
