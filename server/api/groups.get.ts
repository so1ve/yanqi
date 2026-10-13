import { defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  const { bot } = event.context;

  const stored = await bot.store.groups.list();
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
        automatic: saved ? Boolean(saved.aiEnabled) : true,
        admins: bot.config.GROUP_ADMINS[id] ?? [],
        statistics: saved ? await bot.store.groups.statistics(id) : null,
      };
    }),
  );

  return groups;
});
