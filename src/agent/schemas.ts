import type { Static } from "typebox";
import { Type } from "typebox";

export const detectionSchema = Type.Object(
  {
    topics: Type.Array(
      Type.Object(
        {
          id: Type.String({
            description:
              "填写已有话题 ID，或用 new: 开头标记新话题；同一轮可复用新话题标识",
          }),
          title: Type.String({ minLength: 1, maxLength: 100 }),
          description: Type.String({
            maxLength: 500,
            description: "概述要记录的问题、方案或思路",
          }),
          messageIds: Type.Array(Type.String(), {
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
  { action: Type.Enum(["send", "notify", "silent"], { type: "string" }) },
  { additionalProperties: false },
);

export type Detection = Static<typeof detectionSchema>;

export const voiceSchema = Type.Object(
  { text: Type.String({ minLength: 1, pattern: "\\S" }) },
  { additionalProperties: false },
);
