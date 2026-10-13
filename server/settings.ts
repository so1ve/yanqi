import type { Config } from "@yanqi/bot";
import { parseConfig } from "@yanqi/bot";

import type { ManagementDatabase } from "./database";

export interface SavedSettings {
  config: Config;
  autostart: boolean;
  napcatWebUrl: string;
}

export class Settings {
  #db: ManagementDatabase;

  constructor(db: ManagementDatabase) {
    this.#db = db;
  }

  public async load(): Promise<SavedSettings> {
    const row = await this.#db
      .selectFrom("settings")
      .selectAll()
      .where("id", "=", 1)
      .executeTakeFirst();

    if (!row) {
      return {
        config: parseConfig({}),
        autostart: true,
        napcatWebUrl: "http://localhost:6099/webui",
      };
    }

    const config = JSON.parse(row.config);

    // 已部署的数据库仍有这个旧字段；数据目录现在由 Docker 挂载决定。
    delete config.DATA_DIR;

    return {
      config: parseConfig(config),
      autostart: Boolean(row.autostart),
      napcatWebUrl: row.napcatWebUrl,
    };
  }

  public async save(settings: SavedSettings): Promise<void> {
    const values = {
      config: JSON.stringify(settings.config),
      autostart: Number(settings.autostart),
      napcatWebUrl: settings.napcatWebUrl,
    };

    await this.#db
      .insertInto("settings")
      .values({ id: 1, ...values })
      .onConflict((conflict) => conflict.column("id").doUpdateSet(values))
      .execute();
  }
}
