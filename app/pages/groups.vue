<script setup lang="ts">
import { Plus, Refresh } from "@vicons/tabler";
import type { DataTableColumns } from "naive-ui";
import { NButton, NSwitch } from "naive-ui";
import { computed, h, ref } from "vue";

import { NuxtLink } from "#components";
import AddGroupDialog from "~/components/groups/AddGroupDialog.vue";
import { useAction } from "~/composables/useAction";
import { useQueryValue } from "~/composables/useQueryValue";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Group } from "~/types/api";
import { api } from "~/utils/api";
import { formatNumber } from "~/utils/format";

const workspace = useWorkspace();
const { groups, status } = workspace;
const { busy, run } = useAction();
const query = useQueryValue("q", (value) => value ?? "", { replace: true });
const filtered = computed(() =>
  groups.value.filter((item) =>
    `${item.name} ${item.id}`.includes(query.value),
  ),
);
const showAdd = ref(false);

const update = async (
  group: Group,
  changes: Partial<Pick<Group, "enabled" | "automatic" | "admins">>,
): Promise<boolean> =>
  run(async () => {
    await api(`groups/${group.id}/settings`, {
      method: "PUT",
      body: changes,
    });
    await workspace.refresh();
  }, "群设置已保存");
const columns: DataTableColumns<Group> = [
  {
    title: "群",
    key: "name",
    minWidth: 220,
    render: (row) =>
      h("div", [
        h(NuxtLink, { to: `/${row.id}/records` }, { default: () => row.name }),
        h("div", { class: "cell-sub mono" }, row.id),
      ]),
  },
  {
    title: "保存消息",
    key: "enabled",
    width: 110,
    render: (row) =>
      h(NSwitch, {
        value: row.enabled,
        disabled: busy.value,
        onUpdateValue: (enabled) => update(row, { enabled }),
      }),
  },
  {
    title: "自动整理",
    key: "automatic",
    width: 110,
    render: (row) =>
      h(NSwitch, {
        value: row.automatic,
        disabled: busy.value,
        onUpdateValue: (automatic) => update(row, { automatic }),
      }),
  },
  {
    title: "消息 / 纪要",
    key: "statistics",
    width: 140,
    render: (row) =>
      `${formatNumber(row.statistics?.messages ?? 0)} / ${formatNumber(row.statistics?.documents ?? 0)}`,
  },
  {
    title: "成员",
    key: "members",
    width: 80,
    render: (row) => formatNumber(row.members),
  },
  {
    title: "交互权限",
    key: "actions",
    width: 125,
    render: (row) =>
      h(
        NuxtLink,
        { to: `/${row.id}/members` },
        {
          default: () =>
            h(NButton, { size: "small" }, { default: () => "管理成员" }),
        },
      ),
  },
];
</script>

<template>
  <PageHeading
    description="保存已启用群的全部消息；交互权限只决定谁可以向小栖发出请求。"
    title="群管理"
  >
    <NButton :loading="busy" @click="run(workspace.refresh)">
      <template #icon><NIcon :component="Refresh" /></template>
      同步群列表
    </NButton>
    <NButton type="primary" @click="showAdd = true">
      <template #icon><NIcon :component="Plus" /></template>
      添加群号
    </NButton>
    <template #toolbar>
      <ListToolbar>
        <NInput
          v-model:value="query"
          class="search"
          clearable
          placeholder="搜索群名或群号"
        />
        <span class="right muted">
          {{ groups.filter((group) => group.enabled).length }} 个群已启用
        </span>
      </ListToolbar>
    </template>
  </PageHeading>
  <NAlert v-if="!status?.connected" :bordered="false" class="mb-22" type="info">
    NapCat 未连接。连接后可同步群名称和成员。
    <NuxtLink to="/settings">连接设置</NuxtLink>
  </NAlert>
  <LoadState
    :description="
      groups.length > 0
        ? '试试其他群名或群号。'
        : '连接 NapCat 后同步群列表，或手动添加群号。'
    "
    :empty="filtered.length === 0"
    :title="groups.length > 0 ? '没有找到匹配的群' : '还没有添加群'"
  >
    <AppPanel>
      <NDataTable
        :bordered="false"
        :columns
        :data="filtered"
        :row-key="(row: Group) => row.id"
        :scroll-x="785"
      />
    </AppPanel>
    <p class="form-help">
      关闭“保存消息”后，小栖不再处理该群的新消息。只关闭“自动整理”时，仍会保存消息并处理有权限成员的请求。
    </p>
  </LoadState>
  <AddGroupDialog v-if="showAdd" @close="showAdd = false" />
</template>

<style scoped>
.muted {
  color: #798899;
}

:deep(.mono) {
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

:deep(.cell-sub) {
  color: #8a97a7;
  font-size: 11px;
  margin-top: 4px;
}

.form-help {
  font-size: 12px;
  color: #8a97a7;
  margin-top: 7px;
}

.mb-22 {
  margin-bottom: 22px;
}
</style>
