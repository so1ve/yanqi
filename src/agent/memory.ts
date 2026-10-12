import type { AgentState, AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type { Database } from "../storage/schema.ts";
import type { Memory, Message } from "../types.ts";

const key = Type.String({ minLength: 1, maxLength: 60, pattern: "\\S" });
const recallParameters = Type.Object(
  { query: Type.Optional(Type.String({ maxLength: 100 })) },
  { additionalProperties: false },
);
const rememberParameters = Type.Object(
  {
    key,
    content: Type.String({ minLength: 1, maxLength: 500, pattern: "\\S" }),
  },
  { additionalProperties: false },
);
const forgetParameters = Type.Object({ key }, { additionalProperties: false });

const result = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
  details: {},
});

export class Memories {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  public async list(groupId: string, userId: string): Promise<Memory[]> {
    return (
      await this.#db.get(
        "memories",
        { groupId, userId },
        { sort: { updatedAt: "desc", key: "asc" } },
      )
    ).map((row) => ({
      key: row.key,
      content: row.content,
      sourceId: `m${row.sourceMessageId}`,
      updatedAt: row.updatedAt,
    }));
  }

  public tools(message: Message): AgentState["tools"] {
    async function assertActive(db: Database) {
      const [source] = await db.get("messages", { id: message.id });

      if (source!.recalledAt !== null) {
        throw new Error("这次请求已撤回");
      }
    }

    const recall: AgentTool<typeof recallParameters> = {
      name: "recall_memory",
      label: "查询记忆",
      description:
        "查询当前群内这位请求者的记忆。query 留空返回近期条目，填写文字可查找条目；最多返回 6 项。",
      parameters: recallParameters,
      execute: async (_id, args) => {
        const query = (args.query ?? "").trim();
        const matches = (
          await this.list(message.groupId, message.userId)
        ).filter(
          (item) => item.key.includes(query) || item.content.includes(query),
        );

        return result(
          JSON.stringify({
            memories: matches.slice(0, 6),
            matches: matches.length,
          }),
        );
      },
    };
    const remember: AgentTool<typeof rememberParameters> = {
      name: "remember",
      label: "记住信息",
      description:
        "保存或更新请求者在本群的稳定信息。相同 key 替换旧内容，每位成员最多 40 项。",
      parameters: rememberParameters,
      execute: async (_id, args) => {
        const name = args.key.trim();

        await this.#db.transact(async (db) => {
          await assertActive(db);
          const current = await db.get(
            "memories",
            { groupId: message.groupId, userId: message.userId },
            ["key"],
          );

          if (
            current.length >= 40 &&
            !current.some((item) => item.key === name)
          ) {
            throw new Error(
              "本群最多保存你的 40 项记忆，请先删除不再需要的条目",
            );
          }

          await db.upsert("memories", [
            {
              groupId: message.groupId,
              userId: message.userId,
              key: name,
              content: args.content.trim(),
              sourceMessageId: message.id,
              updatedAt: Date.now(),
            },
          ]);
        });

        return result("已记住这项信息。");
      },
    };
    const forget: AgentTool<typeof forgetParameters> = {
      name: "forget_memory",
      label: "忘记信息",
      description: "删除请求者在本群的一项记忆，原始群消息和纪要仍保留。",
      parameters: forgetParameters,
      execute: async (_id, args) => {
        const deleted = await this.#db.transact(async (db) => {
          await assertActive(db);

          return db.remove("memories", {
            groupId: message.groupId,
            userId: message.userId,
            key: args.key.trim(),
          });
        });

        return result(
          deleted.removed
            ? "这项记忆已删除，原始群消息和纪要仍会保留。"
            : "没有找到这项记忆。",
        );
      },
    };

    return [recall, remember, forget];
  }
}
