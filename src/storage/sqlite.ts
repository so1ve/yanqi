import SQLitePlugin from "@koishijs/plugin-database-sqlite";

export class SQLite extends SQLitePlugin {
  #writes: Promise<void> = Promise.resolve();

  public override withTransaction = (
    callback: () => Promise<void>,
  ): Promise<void> => {
    const operation = this.#writes.then(() => super.withTransaction(callback));

    this.#writes = operation.catch(() => {});

    return operation;
  };
}
