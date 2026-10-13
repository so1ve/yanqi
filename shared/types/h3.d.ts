import type { Yanqi } from "@yanqi/bot";

import type { Auth } from "../../server/auth";
import type { AvatarCache } from "../../server/avatars";
import type { LogBuffer } from "../../server/logs";
import type { Settings } from "../../server/storage/settings";

declare module "h3" {
  interface H3EventContext {
    bot: Yanqi;
    settings: Settings;
    auth: Auth;
    avatars: AvatarCache;
    logs: LogBuffer;
  }
}
