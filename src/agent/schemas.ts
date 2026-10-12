import { z } from "zod";

export const detectionSchema = z.object({
  topics: z.array(
    z.object({
      id: z
        .string()
        .describe(
          "填写已有话题 ID，或用 new: 开头标记新话题；同一轮可复用新话题标识",
        ),
      title: z.string().min(1).max(100),
      description: z.string().max(500).describe("概述要记录的问题、方案或思路"),
      messageIds: z
        .array(z.string())
        .min(1)
        .describe("属于该话题的消息 ID，只能从输入的 messages 和 context 中选择"),
    }),
  ),
});

export const publicationSchema = z.object({
  publish: z.boolean(),
});

export type Detection = z.infer<typeof detectionSchema>;

export const voiceSchema = z
  .object({ text: z.string().trim().min(1).max(3000) })
  .strict();
