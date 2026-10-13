export class StoreError extends Error {
  constructor(
    public readonly kind: "not_found" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export function required<T>(item: T | undefined): T {
  if (item === undefined) {
    throw new StoreError("not_found", "记录不存在");
  }

  return item;
}
