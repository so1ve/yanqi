import { stripVTControlCharacters } from "node:util";

import { Logger } from "@koishijs/core";
import type { Config } from "@yanqi/bot";

export class LogBuffer {
  #entries: {
    id: number;
    time: number;
    level: string;
    name: string;
    text: string;
  }[] = [];

  #next = 0;

  constructor(config: () => Config) {
    Object.assign(Logger.targets[0]!, {
      showTime: "yyyy-MM-dd hh:mm:ss.SSS",
      showDiff: false,
      label: { width: 14, align: "right" },
    });
    Logger.targets.push({
      colors: 0,
      record: (entry) => {
        const current = config();
        const secrets = [
          current.ONEBOT_TOKEN,
          current.DECISION_API_KEY,
          current.AI_MODEL.apiKey,
          current.AI_VISION_MODEL?.apiKey,
          current.AI_AUDIO_MODEL?.apiKey,
        ];
        let text = stripVTControlCharacters(entry.content);

        for (const secret of secrets) {
          if (secret) {
            text = text.replaceAll(secret, "[密钥已隐藏]");
          }
        }

        this.#entries.push({
          id: ++this.#next,
          time: entry.timestamp,
          level: entry.type,
          name: entry.name,
          text,
        });
        if (this.#entries.length > 1000) {
          this.#entries.shift();
        }
      },
    });
  }

  public read(after: number) {
    return this.#entries.filter((entry) => entry.id > after);
  }
}
