import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Static, TSchema } from "typebox";
import * as Value from "typebox/value";

export async function body<S extends TSchema>(
  ctx: Context,
  schema: S,
): Promise<Static<S>> {
  let value: unknown;

  try {
    value = Value.Default(schema, await ctx.req.json());
  } catch {
    throw new HTTPException(400, { message: "请求需要有效的 JSON" });
  }

  if (!Value.Check(schema, value)) {
    throw new HTTPException(400, {
      message: Value.Errors(schema, value)
        .map((error) => `${error.instancePath} ${error.message}`)
        .join("；"),
    });
  }

  return value;
}

export function integer(
  value: string | undefined,
  fallback = 1,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw new HTTPException(400, { message: "分页或编号参数无效" });
  }

  return number;
}

export function pagination(ctx: Context) {
  const page = integer(ctx.req.query("page"));
  const limit = integer(ctx.req.query("limit"), 30, 100);

  return { page, limit, offset: (page - 1) * limit };
}

export function search(ctx: Context): RegExp | undefined {
  const query = ctx.req.query("q")?.trim();

  if (!query) {
    return undefined;
  }

  if (query.length > 200) {
    throw new HTTPException(400, { message: "搜索内容过长" });
  }

  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

export function requireItem<T>(item: T | undefined): T {
  if (!item) {
    throw new HTTPException(404, { message: "记录不存在" });
  }

  return item;
}
