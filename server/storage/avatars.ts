import type { ManagementDatabase } from "./database";

export interface Avatar {
  contentType: string;
  data: Uint8Array;
}

export class Avatars {
  #db: ManagementDatabase;

  constructor(db: ManagementDatabase) {
    this.#db = db;
  }

  public get(userId: string): Promise<Avatar | undefined> {
    return this.#db
      .selectFrom("avatars")
      .select(["contentType", "data"])
      .where("userId", "=", userId)
      .executeTakeFirst();
  }

  public async save(userId: string, avatar: Avatar): Promise<void> {
    await this.#db
      .insertInto("avatars")
      .values({ userId, ...avatar })
      .onConflict((conflict) => conflict.column("userId").doUpdateSet(avatar))
      .execute();
  }

  public async clear(): Promise<void> {
    await this.#db.deleteFrom("avatars").execute();
  }
}
