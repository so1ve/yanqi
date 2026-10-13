import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "typebox";
import { Type } from "typebox";

import type { Config } from "../../config.ts";
import type { Notes } from "../../recording/notes.ts";
import type { Store } from "../../storage/store.ts";
import type { Message } from "../../types.ts";

export interface RequestContext {
  store: Store;
  message: Message;
}

export interface ReadContext extends RequestContext {
  config: Config;
}

export interface ToolContext extends ReadContext {
  notes: Notes;
  wake: () => void;
}

export const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });

export const directive = Type.Optional(
  Type.Union([
    Type.Literal("auto"),
    Type.Literal("send"),
    Type.Literal("hold"),
  ]),
);
export const title = Type.Optional(
  Type.String({ minLength: 1, maxLength: 100 }),
);
export const topicId = Type.String({ minLength: 1 });
export const revision = Type.Optional(
  Type.Integer({
    minimum: 1,
    description: "纪要的版本号，例如第 2 版填 2；省略时使用最新版。",
  }),
);

export const tool = <P extends TSchema>(
  context: RequestContext,
  name: string,
  description: string,
  parameters: P,
  execute: (args: Static<P>, signal?: AbortSignal) => Promise<unknown>,
): AgentTool<P> => ({
  name,
  label: name,
  description,
  parameters: { ...parameters, type: "object" },
  execute: async (_id, args, signal) => {
    signal?.throwIfAborted();
    await assertActive(context);
    const result = await execute(args, signal);

    return {
      content: [
        {
          type: "text",
          text: typeof result === "string" ? result : JSON.stringify(result),
        },
      ],
      details: {},
    };
  },
});

export async function assertActive({
  store,
  message,
}: RequestContext): Promise<void> {
  if ((await store.messages.get(message.id)).recalledAt !== null) {
    throw new Error("这次请求已撤回");
  }
}

export async function getTopic({ store, message }: RequestContext, id: string) {
  const topic = await store.topics.get(id);

  if (topic.groupId !== message.groupId) {
    throw new Error("只能处理本群话题");
  }

  return topic;
}
