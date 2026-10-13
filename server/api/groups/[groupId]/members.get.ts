import { createError, defineEventHandler } from "h3";

import { groupParam } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;
  const groupId = groupParam(event);

  if (!bot.online) {
    throw createError({
      statusCode: 503,
      message: "请先连接 NapCat，再读取群成员",
    });
  }

  const config = bot.config;

  const members = await bot.napcat.getGroupMemberList(groupId, true);

  return members
    .filter((member) => String(member.user_id) !== config.BOT_QQ)
    .map((member) => ({
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
    }));
});
