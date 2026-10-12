import { computed } from "vue";

import { useState } from "#imports";
import type { Group, Status } from "~/types/api";
import { api } from "~/utils/api";

export function useWorkspace() {
  const groups = useState<Group[]>("groups", () => []);
  const groupId = useState<string>("groupId", () => "");
  const status = useState<Status | null>("status", () => null);
  const group = computed(() =>
    groups.value.find((item) => item.id === groupId.value),
  );

  async function refresh(): Promise<void> {
    status.value = await api<Status>("status");
    groups.value = await api<Group[]>("groups");
    if (!groups.value.some((item) => item.id === groupId.value)) {
      groupId.value =
        groups.value.find((item) => item.enabled)?.id ??
        groups.value[0]?.id ??
        "";
    }
  }

  return { groups, groupId, group, status, refresh };
}
