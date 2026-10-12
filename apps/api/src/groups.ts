import type { Yanqi } from "@yanqi/bot";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Type } from "typebox";

import type { ControlStore } from "./control.ts";
import { body } from "./http.ts";

export function registerGroups(
  app: Hono,
  bot: Yanqi,
  control: ControlStore,
): void {
  app.get("/api/groups", async (ctx) => {
    const stored = await bot.database.get("groups", {});
    const live = bot.online ? await bot.napcat.getGroupList() : [];
    const ids = [
      ...new Set([
        ...stored.map((group) => group.id),
        ...bot.config.GROUP_IDS,
        ...live.map((group) => String(group.group_id)),
      ]),
    ];
    const groups = await Promise.all(
      ids.map(async (id) => {
        const remote = live.find((group) => String(group.group_id) === id);
        const saved = stored.find((group) => group.id === id);

        return {
          id,
          name: remote?.group_name ?? id,
          members: remote?.member_count ?? null,
          enabled: bot.config.GROUP_IDS.includes(id),
          automatic: saved?.aiEnabled ?? true,
          admins: bot.config.GROUP_ADMINS[id] ?? [],
          statistics: saved ? await bot.store.groups.statistics(id) : null,
        };
      }),
    );

    return ctx.json(groups);
  });

  app.use("/api/groups/:groupId/*", async (ctx, next) => {
    const groupId = ctx.req.param("groupId");

    if (!/^\d+$/.test(groupId)) {
      throw new HTTPException(400, { message: "群号无效" });
    }

    await next();
  });
  app.put("/api/groups/:groupId/settings", async (ctx) => {
    const groupId = ctx.req.param("groupId");
    const input = await body(
      ctx,
      Type.Object({
        enabled: Type.Boolean(),
        automatic: Type.Boolean(),
        admins: Type.Array(Type.String({ pattern: "^\\d+$" }), {
          maxItems: 1000,
        }),
      }),
    );
    const config = bot.config;

    config.GROUP_IDS = input.enabled
      ? [...new Set([...config.GROUP_IDS, groupId])]
      : config.GROUP_IDS.filter((id) => id !== groupId);
    config.GROUP_ADMINS[groupId] = [...new Set(input.admins)];
    if (config.GROUP_IDS.length === 0 && bot.running) {
      throw new HTTPException(409, {
        message: "请先停止机器人，再停用最后一个群",
      });
    }

    await bot.database.upsert("groups", [
      { id: groupId, aiEnabled: input.automatic },
    ]);
    await bot.configure(config);
    const settings = await control.settings();

    await control.save(config, settings.autostart, settings.napcatWebUrl);

    return ctx.json({ ok: true });
  });
  app.get("/api/groups/:groupId/members", async (ctx) => {
    if (!bot.online) {
      throw new HTTPException(503, {
        message: "请先连接 NapCat，再读取群成员",
      });
    }

    const config = bot.config;
    const groupId = ctx.req.param("groupId");
    const members = await bot.napcat.getGroupMemberList(groupId, true);

    return ctx.json(
      members.map((member) => ({
        id: String(member.user_id),
        name: member.card || member.nickname,
        nickname: member.nickname,
        role: member.role,
        administrator:
          config.ADMIN_IDS.includes(String(member.user_id)) ||
          (config.GROUP_ADMINS[groupId] ?? []).includes(String(member.user_id)),
        inherited:
          member.role === "owner" ||
          member.role === "admin" ||
          config.ADMIN_IDS.includes(String(member.user_id)),
      })),
    );
  });
  app.get("/api/napcat/account", async (ctx) => {
    if (!bot.online) {
      throw new HTTPException(503, { message: "NapCat 尚未连接" });
    }

    return ctx.json(await bot.napcat.getLoginInfo());
  });
}
