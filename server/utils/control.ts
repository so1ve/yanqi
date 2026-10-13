import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Config } from "@yanqi/bot";
import { parseConfig } from "@yanqi/bot";
import { Kysely } from "kysely";
import { NodeNativeSqliteDialect } from "kysely-node-native-sqlite";

interface ManagementDatabase {
  settings: {
    id: number;
    config: string;
    autostart: number;
    napcatWebUrl: string;
  };
  accounts: { id: number; password: string };
  sessions: { id: string; expiresAt: number };
}

export class ControlStore {
  public readonly db: Kysely<ManagementDatabase>;

  private constructor(directory: string) {
    this.db = new Kysely<ManagementDatabase>({
      dialect: new NodeNativeSqliteDialect(
        join(directory, "management.sqlite"),
      ),
    });
  }

  public static async open(directory: string): Promise<ControlStore> {
    await mkdir(directory, { recursive: true });
    const store = new ControlStore(directory);
    const { db } = store;

    await db.schema
      .createTable("settings")
      .ifNotExists()
      .addColumn("id", "integer", (column) => column.primaryKey())
      .addColumn("config", "text", (column) => column.notNull())
      .addColumn("autostart", "integer", (column) =>
        column.notNull().defaultTo(0),
      )
      .addColumn("napcatWebUrl", "text", (column) =>
        column.notNull().defaultTo("http://localhost:6099/webui"),
      )
      .execute();
    await db.schema
      .createTable("accounts")
      .ifNotExists()
      .addColumn("id", "integer", (column) => column.primaryKey())
      .addColumn("password", "text", (column) => column.notNull())
      .execute();
    await db.schema
      .createTable("sessions")
      .ifNotExists()
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("expiresAt", "integer", (column) => column.notNull())
      .execute();
    await db
      .insertInto("settings")
      .values({
        id: 1,
        config: JSON.stringify(parseConfig({})),
        autostart: 0,
        napcatWebUrl: "http://localhost:6099/webui",
      })
      .onConflict((conflict) => conflict.column("id").doNothing())
      .execute();
    await db
      .deleteFrom("sessions")
      .where("expiresAt", "<", Date.now())
      .execute();

    return store;
  }

  public async settings() {
    const row = await this.db
      .selectFrom("settings")
      .selectAll()
      .where("id", "=", 1)
      .executeTakeFirstOrThrow();
    const config = JSON.parse(row.config);

    // 旧数据库仍可能保存数据目录，现在统一使用 Docker 挂载目录。
    delete config.DATA_DIR;

    return {
      config: parseConfig(config),
      autostart: Boolean(row.autostart),
      napcatWebUrl: row.napcatWebUrl,
    };
  }

  public async save(
    config: Config,
    autostart: boolean,
    napcatWebUrl: string,
  ): Promise<void> {
    await this.db
      .updateTable("settings")
      .set({
        config: JSON.stringify(config),
        autostart: Number(autostart),
        napcatWebUrl,
      })
      .where("id", "=", 1)
      .execute();
  }

  public close(): Promise<void> {
    return this.db.destroy();
  }
}
