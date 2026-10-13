import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { App } from "@koishijs/core";
import type { Config, Database } from "@yanqi/bot";
import { SQLite, parseConfig } from "@yanqi/bot";

declare module "@koishijs/core" {
  interface Tables {
    settings: {
      id: number;
      config: Config;
      autostart: boolean;
      napcatWebUrl: string;
    };
    accounts: { id: number; password: string };
    sessions: { id: string; expiresAt: number };
  }
}

export class ControlStore {
  #app: App;
  public readonly db: Database;

  private constructor(app: App) {
    this.#app = app;
    this.db = app.database;
  }

  public static async open(
    directory: string,
    initial: Config,
  ): Promise<ControlStore> {
    await mkdir(directory, { recursive: true });
    const app = new App();

    app.plugin(SQLite, { path: join(directory, "management.sqlite") });
    app.model.extend("settings", {
      id: "integer",
      config: "json",
      autostart: { type: "boolean", initial: false },
      napcatWebUrl: { type: "text", initial: "http://localhost:6099" },
    });
    app.model.extend("accounts", { id: "integer", password: "text" });
    app.model.extend("sessions", { id: "string", expiresAt: "integer" });
    await app.start();
    const store = new ControlStore(app);

    if ((await store.db.get("settings", 1)).length === 0) {
      await store.db.create("settings", {
        id: 1,
        config: initial,
        autostart: false,
      });
    }

    await store.db.remove("sessions", { expiresAt: { $lt: Date.now() } });

    return store;
  }

  public async settings() {
    const [row] = await this.db.get("settings", 1);

    if (!row) {
      throw new Error("管理配置不存在");
    }

    return { ...row, config: parseConfig(row.config) };
  }

  public async save(
    config: Config,
    autostart: boolean,
    napcatWebUrl: string,
  ): Promise<void> {
    await this.db.set("settings", 1, { config, autostart, napcatWebUrl });
  }

  public close(): Promise<void> {
    return this.#app.stop();
  }
}
