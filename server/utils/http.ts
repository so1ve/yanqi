import type { Yanqi } from "@yanqi/bot";
import type { H3Event } from "h3";
import { createError, getQuery, getRequestWebStream, getRouterParam } from "h3";
import type { Static, TSchema } from "typebox";
import * as Value from "typebox/value";

import type { Auth } from "./auth";
import type { ControlStore } from "./control";
import type { LogBuffer } from "./logs";

declare module "h3" {
  interface H3EventContext {
    bot: Yanqi;
    control: ControlStore;
    auth: Auth;
    logs: LogBuffer;
  }
}

export async function body<S extends TSchema>(
  event: H3Event,
  schema: S,
): Promise<Static<S>> {
  let size = 0;
  const stream = getRequestWebStream(event)?.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > 5 * 1024 * 1024) {
          throw createError({ statusCode: 413, message: "请求内容超过 5 MiB" });
        }

        controller.enqueue(chunk);
      },
    }),
  );
  let value: unknown;

  try {
    value = Value.Default(schema, await new Response(stream).json());
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw createError({ statusCode: 400, message: "请求需要有效的 JSON" });
    }

    throw error;
  }

  if (!Value.Check(schema, value)) {
    throw createError({
      statusCode: 400,
      message: Value.Errors(schema, value)
        .map((error) => `${error.instancePath} ${error.message}`)
        .join("；"),
    });
  }

  return value;
}

export function groupParam(event: H3Event): string {
  const id = getRouterParam(event, "groupId")!;

  if (!/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, message: "群号无效" });
  }

  return id;
}

export function queryParam(event: H3Event, key: string): string | undefined {
  const value = getQuery<Record<string, string | string[]>>(event)[key];

  if (Array.isArray(value)) {
    throw createError({ statusCode: 400, message: `${key} 不能重复` });
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
    throw createError({ statusCode: 400, message: "分页或编号参数无效" });
  }

  return number;
}

export function pagination(event: H3Event) {
  const page = integer(queryParam(event, "page"));
  const limit = integer(queryParam(event, "limit"), 30, 100);

  return { page, limit, offset: (page - 1) * limit };
}

export function search(event: H3Event): RegExp | undefined {
  const query = queryParam(event, "q")?.trim();

  if (!query) {
    return undefined;
  }

  if (query.length > 200) {
    throw createError({ statusCode: 400, message: "搜索内容过长" });
  }

  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

export function requireItem<T>(item: T | undefined): T {
  if (!item) {
    throw createError({ statusCode: 404, message: "记录不存在" });
  }

  return item;
}
