import type { Static } from "typebox";
import { Type } from "typebox";
import { Format } from "typebox/format";

import type { MessageMetadata } from "../storage/messages.ts";
import type { Store } from "../storage/store.ts";
import type { Message } from "../types.ts";
import { beijingDate } from "../utils/time.ts";

const date = Type.String({
  description: "YYYY-MM-DD 按北京时间零点解释；也可使用带时区的 ISO 时间。",
});

export const sourceId = Type.String({ pattern: "^m[1-9][0-9]*$" });

export const sourceScope = Type.Union([
  Type.Object({ all: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object(
    { fromMessageId: sourceId, throughMessageId: Type.Optional(sourceId) },
    {
      additionalProperties: false,
      description:
        "完整的消息区间，包含起止消息；省略终点时包含直到当前请求的消息。适用于从上下文确定讨论起止点。",
    },
  ),
  Type.Object(
    {
      day: Type.String({
        description:
          "北京时间的自然日：today 或 YYYY-MM-DD。today 以请求发出时的日期为准。",
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      sinceFirstMessageBy: Type.String({
        pattern: "^\\d+$",
        description:
          "成员 QQ 号；从本群已保存的该成员首次发言起，包含此后所有成员的讨论。",
      }),
    },
    { additionalProperties: false },
  ),
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
      sourceIds: Type.Array(sourceId, {
        minItems: 1,
      }),
    },
    { additionalProperties: false },
  ),
]);

function timestamp(value: string): number {
  if (Format.IsDate(value)) {
    return Date.parse(`${value}T00:00:00+08:00`);
  }

  // RFC 3339 要求秒数，补齐只写到分钟的 ISO 时间。
  const datetime = value.replace(
    /T(\d{2}:\d{2})(?=Z$|[+-]\d{2}:\d{2}$)/,
    "T$1:00",
  );
  const result = Date.parse(datetime);

  if (!Format.IsDateTime(datetime) || !Number.isFinite(result)) {
    throw new Error("时间需要使用 YYYY-MM-DD 或带时区的 ISO 时间");
  }

  return result;
}

export async function selectSources(
  store: Store,
  request: Message,
  scope: Static<typeof sourceScope>,
): Promise<MessageMetadata[]> {
  let sources: MessageMetadata[];

  if ("sourceIds" in scope) {
    const ids = [...new Set(scope.sourceIds)].map((id) => Number(id.slice(1)));

    sources = await store.messages.listMetadata(request.groupId, request.id, {
      ids,
    });

    if (sources.length !== ids.length) {
      throw new Error("只能使用当前请求及此前保存的本群成员原文");
    }
  } else if ("fromMessageId" in scope) {
    const fromId = Number(scope.fromMessageId.slice(1));
    const throughId = scope.throughMessageId
      ? Number(scope.throughMessageId.slice(1))
      : request.id;
    const ids = [...new Set([fromId, throughId])];
    const boundaries = await store.messages.listMetadata(
      request.groupId,
      request.id,
      {
        ids,
        includeBot: true,
      },
    );

    if (fromId > throughId || boundaries.length !== ids.length) {
      throw new Error(
        "消息区间必须按先后顺序指定，且仅限本群当前请求及此前的消息",
      );
    }

    sources = await store.messages.listMetadata(request.groupId, throughId, {
      fromId,
    });
  } else if ("topicIds" in scope) {
    for (const id of new Set(scope.topicIds)) {
      const topic = await store.topics.get(id);

      if (topic.groupId !== request.groupId) {
        throw new Error("只能读取本群话题");
      }
    }

    sources = await store.messages.listMetadata(
      request.groupId,
      request.id - 1,
      {
        topicIds: scope.topicIds,
      },
    );
  } else {
    let from = 0;
    let to = Number.MAX_SAFE_INTEGER;

    if ("day" in scope) {
      const day =
        scope.day === "today" ? beijingDate(request.sentAt) : scope.day;

      if (!Format.IsDate(day)) {
        throw new Error("日期需要使用 today 或 YYYY-MM-DD");
      }

      from = timestamp(day);
      to = from + 86_400_000;
    } else if ("minutes" in scope) {
      from = request.sentAt - scope.minutes * 60_000;
    } else if ("from" in scope) {
      from = timestamp(scope.from);
      to =
        scope.to === undefined ? Number.MAX_SAFE_INTEGER : timestamp(scope.to);

      if (to <= from) {
        throw new Error("结束时间必须晚于开始时间");
      }
    }

    sources = await store.messages.listMetadata(
      request.groupId,
      request.id - 1,
      {
        from,
        to,
      },
    );

    if ("sinceFirstMessageBy" in scope) {
      const first = sources.findIndex(
        (source) => source.userId === scope.sinceFirstMessageBy,
      );

      sources = first === -1 ? [] : sources.slice(first);
    }
  }

  return sources;
}
