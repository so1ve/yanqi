import type { ManagementDatabase } from "./database";

export class Accounts {
  #db: ManagementDatabase;

  constructor(db: ManagementDatabase) {
    this.#db = db;
  }

  public async password(): Promise<string | undefined> {
    const account = await this.#db
      .selectFrom("accounts")
      .select("password")
      .where("id", "=", 1)
      .executeTakeFirst();

    return account?.password;
  }

  public async initialize(password: string): Promise<void> {
    await this.#db.insertInto("accounts").values({ id: 1, password }).execute();
  }

  public async replacePassword(password: string): Promise<void> {
    await this.#db.transaction().execute(async (db) => {
      await db
        .updateTable("accounts")
        .set({ password })
        .where("id", "=", 1)
        .execute();
      await db.deleteFrom("sessions").execute();
    });
  }

  public async createSession(id: string, expiresAt: number): Promise<void> {
    await this.#db.insertInto("sessions").values({ id, expiresAt }).execute();
  }

  public async hasSession(id: string, now: number): Promise<boolean> {
    const session = await this.#db
      .selectFrom("sessions")
      .select("id")
      .where("id", "=", id)
      .where("expiresAt", ">", now)
      .executeTakeFirst();

    return session !== undefined;
  }

  public async deleteSession(id: string): Promise<void> {
    await this.#db.deleteFrom("sessions").where("id", "=", id).execute();
  }

  public async deleteExpiredSessions(now: number): Promise<void> {
    await this.#db
      .deleteFrom("sessions")
      .where("expiresAt", "<", now)
      .execute();
  }
}
