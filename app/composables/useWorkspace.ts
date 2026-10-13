import { computed } from "vue";

import { useRoute, useRouter, useState } from "#imports";
import type { Group, Status } from "~/types/api";
import { api } from "~/utils/api";

export function useWorkspace() {
  const route = useRoute();
  const router = useRouter();
  const groups = useState<Group[]>("groups", () => []);
  const groupId = computed(() =>
    typeof route.query.group === "string" && /^\d+$/.test(route.query.group)
      ? route.query.group
      : "",
  );
  const status = useState<Status | null>("status", () => null);
  const group = computed(() =>
    groups.value.find((item) => item.id === groupId.value),
  );

  async function refresh(): Promise<void> {
    status.value = await api<Status>("status");
    groups.value = await api<Group[]>("groups");
    if (!groups.value.some((item) => item.id === groupId.value)) {
      const id =
        groups.value.find((item) => item.enabled)?.id ??
        groups.value[0]?.id ??
        "";

      await router.replace({
        query: { ...route.query, group: id || undefined },
        hash: route.hash,
      });
    }
  }

  const groupLink = (path: string) => ({
    path,
    query:
      path === route.path ? route.query : { group: groupId.value || undefined },
  });

  async function selectGroup(id: string): Promise<void> {
    if (id === groupId.value) {
      return;
    }

    if (route.path.startsWith("/records/")) {
      await router.push({ path: "/records", query: { group: id } });

      return;
    }

    await router.push({
      query: {
        ...route.query,
        group: id,
        page: undefined,
        task: undefined,
        members: undefined,
        memberPage: undefined,
        memberQ: undefined,
      },
      hash: route.hash,
    });
  }

  return { groups, groupId, group, status, refresh, groupLink, selectGroup };
}
