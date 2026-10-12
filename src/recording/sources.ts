import type { Static } from "typebox";
import { Type } from "typebox";
import { z } from "zod";

import type { Store } from "../storage/store.ts";
import type { Message } from "../types.ts";

const date = Type.String({
  description: "YYYY-MM-DD 按北京时间零点解释；也可使用带时区的 ISO 时间。",
});

export const sourceScope = Type.Union([
  Type.Object({ all: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object(
    { from: date, to: Type.Optional(date) },
    {
      additionalProperties: false,
      description: "包含 from，不包含 to；省略 to 表示直到当前请求。",
    },
  ),
  Type.Object(
    { minutes: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { topicIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      sourceIds: Type.Array(Type.String({ pattern: "^m[1-9][0-9]*$" }), {
        minItems: 1,
      }),
    },
    { additionalProperties: false },
  ),
]);

function timestamp(value: string): number {
  if (z.iso.date().safeParse(value).success) {
    return Date.parse(`${value}T00:00:00+08:00`);
  }

  return Date.parse(z.iso.datetime({ offset: true }).parse(value));
}

export async function selectSources(
  store: Store,
  request: Message,
  scope: Static<typeof sourceScope>,
): Promise<Message[]> {
  let sources: Message[];

  if ("sourceIds" in scope) {
    sources = await Promise.all(
      [...new Set(scope.sourceIds)].map((id) =>
        store.message(Number(id.slice(1))),
      ),
    );

    if (
      sources.some(
        (source) =>
          source.groupId !== request.groupId ||
          source.isBot ||
          source.id > request.id,
      )
    ) {
      throw new Error("只能使用当前请求及此前保存的本群成员原文");
    }
  } else if ("topicIds" in scope) {
    sources = [];

    for (const id of new Set(scope.topicIds)) {
      const topic = await store.topic(id);

      if (topic.groupId !== request.groupId) {
        throw new Error("只能读取本群话题");
      }

      sources.push(...(await store.topicMessages(topic.id, request.id - 1)));
    }
  } else {
    let from: number | undefined;
    let to: number | undefined;

    if ("minutes" in scope) {
      from = request.sentAt - scope.minutes * 60_000;
    } else if ("from" in scope) {
      from = timestamp(scope.from);
      to = scope.to === undefined ? undefined : timestamp(scope.to);

      if (to !== undefined && to <= from) {
        throw new Error("结束时间必须晚于开始时间");
      }
    }

    sources = await store.history(request.groupId, request.id - 1, from, to);
  }

  return [
    ...new Map(
      sources
        .filter((source) => !source.isBot)
        .map((source) => [source.id, source]),
    ).values(),
  ].sort((a, b) => a.id - b.id);
}
