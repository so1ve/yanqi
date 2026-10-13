import type { Yanqi } from "@yanqi/bot";

import type { Auth } from "../../server/auth";
import type { LogBuffer } from "../../server/logs";
import type { Settings } from "../../server/settings";

declare module "h3" {
  interface H3EventContext {
    bot: Yanqi;
    settings: Settings;
    auth: Auth;
    logs: LogBuffer;
  }
}
