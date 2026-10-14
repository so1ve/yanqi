import type { Static } from "typebox";
import { Type } from "typebox";

const newTopicId = Type.String({
  pattern: "^new:",
  description: "新话题用 new: 开头；已有话题沿用输入的 ID",
});

export const detectionSchema = (messageIds: string[], topicIds: string[]) =>
  Type.Object(
    {
      topics: Type.Array(
        Type.Object(
          {
            id:
              topicIds.length === 0
                ? newTopicId
                : Type.Union([
                    Type.Enum(topicIds, { type: "string" }),
                    newTopicId,
                  ]),
            title: Type.String({ minLength: 1, maxLength: 100 }),
            description: Type.String({
              maxLength: 500,
              description: "概述要记录的问题、方案或思路",
            }),
            messageIds: Type.Array(Type.Enum(messageIds, { type: "string" }), {
              minItems: 1,
              description:
                "属于该话题的消息 ID，只能从输入的 messages 和 context 中选择",
            }),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  );

export const publicationSchema = Type.Object(
  {
    action: Type.Enum(["send", "notify", "silent"], { type: "string" }),
    text: Type.String({ description: "notify 时填写保存通知，否则留空" }),
  },
  { additionalProperties: false },
);

export type Detection = Static<ReturnType<typeof detectionSchema>>;
export type Publication = Static<typeof publicationSchema>;
