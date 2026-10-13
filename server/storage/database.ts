import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";

import type { BotTables } from "@yanqi/bot";
import { createTables } from "@yanqi/bot";
import { Kysely, SqliteDialect } from "kysely";

interface Tables {
  settings: {
    id: number;
    config: string;
    autostart: number;
    napcatWebUrl: string;
  };
  accounts: { id: number; password: string };
  sessions: { id: string; expiresAt: number };
  avatars: { userId: string; contentType: string; data: Uint8Array };
}

export type ManagementDatabase = Kysely<Tables>;

function connect<T>(filename: string): Kysely<T> {
  const sqlite = new DatabaseSync(filename);

  // SQLite 的 lower() 只处理 ASCII；保留原搜索对 Unicode 大小写的支持。
  sqlite.function("contains_text", { deterministic: true }, (value, query) =>
    Number(
      new RegExp(
        String(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      ).test(String(value)),
    ),
  );

  return new Kysely<T>({
    dialect: new SqliteDialect({
      // Kysely 的 SQLite 接口接收参数数组，node:sqlite 接收展开的参数。
      database: {
        close: () => sqlite.close(),
        prepare(query) {
          const statement = sqlite.prepare(query);

          return {
            reader: statement.columns().length > 0,
            all: (parameters) =>
              statement.all(...(parameters as SQLInputValue[])),
            run: (parameters) =>
              statement.run(...(parameters as SQLInputValue[])),
            iterate: (parameters) =>
              statement.iterate(...(parameters as SQLInputValue[])),
          };
        },
      },
    }),
  });
}

export async function openDatabases(directory: string) {
  await mkdir(directory, { recursive: true });

  const db = connect<Tables>(join(directory, "management.sqlite"));

  await db.schema
    .createTable("settings")
    .ifNotExists()
    .addColumn("id", "integer", (column) => column.primaryKey())
    .addColumn("config", "text", (column) => column.notNull())
    .addColumn("autostart", "integer", (column) => column.notNull())
    .addColumn("napcatWebUrl", "text", (column) => column.notNull())
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

  await db.schema
    .createTable("avatars")
    .ifNotExists()
    .addColumn("userId", "text", (column) => column.primaryKey())
    .addColumn("contentType", "text", (column) => column.notNull())
    .addColumn("data", "blob", (column) => column.notNull())
    .execute();

  const bot = connect<BotTables>(join(directory, "yanqi.sqlite"));

  await createTables(bot);

  return { management: db, bot };
}
