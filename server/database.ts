import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { Kysely } from "kysely";
import { NodeNativeSqliteDialect } from "kysely-node-native-sqlite";

interface Tables {
  settings: {
    id: number;
    config: string;
    autostart: number;
    napcatWebUrl: string;
  };
  accounts: { id: number; password: string };
  sessions: { id: string; expiresAt: number };
}

export type ManagementDatabase = Kysely<Tables>;

export async function openDatabase(
  directory: string,
): Promise<ManagementDatabase> {
  await mkdir(directory, { recursive: true });

  const db = new Kysely<Tables>({
    dialect: new NodeNativeSqliteDialect(join(directory, "management.sqlite")),
  });

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

  return db;
}
