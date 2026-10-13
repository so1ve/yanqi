import { computed } from "vue";

import { useRoute, useState } from "#imports";
import type { Group, Status } from "~/types/api";
import { api } from "~/utils/api";

export function useWorkspace() {
  const route = useRoute();
  const groups = useState<Group[]>("groups", () => []);
  const groupId = computed(() =>
    typeof route.params.group === "string" ? route.params.group : "",
  );
  const status = useState<Status | null>("status", () => null);
  const group = computed(() =>
    groups.value.find((item) => item.id === groupId.value),
  );

  async function refresh(): Promise<void> {
    [status.value, groups.value] = await Promise.all([
      api<Status>("status"),
      api<Group[]>("groups"),
    ]);
  }

  return { groups, groupId, group, status, refresh };
}
