<script setup lang="ts">
import { Plus, Refresh } from "@vicons/tabler";
import type { DataTableColumns } from "naive-ui";
import { NButton, NSwitch } from "naive-ui";
import { computed, h, ref } from "vue";

import AddGroupDialog from "~/components/groups/AddGroupDialog.vue";
import GroupMembersDialog from "~/components/groups/GroupMembersDialog.vue";
import { useAction } from "~/composables/useAction";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Group } from "~/types/api";
import { api } from "~/utils/api";
import { formatNumber } from "~/utils/format";

const workspace = useWorkspace();
const { groups, status } = workspace;
const { busy, run } = useAction();
const query = ref("");
const filtered = computed(() =>
  groups.value.filter((item) =>
    `${item.name} ${item.id}`.includes(query.value),
  ),
);
const active = ref<Group | null>(null);
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
        h("strong", row.name),
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
        NButton,
        {
          size: "small",
          disabled: !status.value?.connected,
          onClick: () => {
            active.value = row;
          },
        },
        { default: () => "管理成员" },
      ),
  },
];
</script>

<template>
  <PageHeading
    description="选择要记录的群，以及可以向小栖发出请求的成员。"
    title="群与成员"
  >
    <NButton :loading="busy" @click="run(workspace.refresh)">
      <template #icon><NIcon :component="Refresh" /></template>
      同步群列表
    </NButton>
    <NButton type="primary" @click="showAdd = true">
      <template #icon><NIcon :component="Plus" /></template>
      添加群号
    </NButton>
  </PageHeading>
  <NAlert v-if="!status?.connected" :bordered="false" class="mb-22" type="info">
    NapCat 未连接。连接后可同步群名称和成员。
    <NuxtLink to="/settings">连接设置</NuxtLink>
  </NAlert>
  <div class="toolbar">
    <NInput
      v-model:value="query"
      class="search"
      clearable
      placeholder="搜索群名或群号"
    />
    <span class="right muted">
      {{ groups.filter((group) => group.enabled).length }} 个群已启用
    </span>
  </div>
  <LoadState
    :description="
      groups.length > 0
        ? '试试其他群名或群号。'
        : '连接 NapCat 后同步群列表，或手动添加群号。'
    "
    :empty="filtered.length === 0"
    :title="groups.length > 0 ? '没有找到匹配的群' : '还没有添加群'"
  >
    <div class="panel">
      <NDataTable
        :bordered="false"
        :columns
        :data="filtered"
        :row-key="(row: Group) => row.id"
        :scroll-x="785"
      />
    </div>
    <p class="form-help">
      关闭“保存消息”后，小栖不再处理该群的新消息。只关闭“自动整理”时，仍会保存消息并处理有权限成员的请求。
    </p>
  </LoadState>
  <GroupMembersDialog v-if="active" :group="active" @close="active = null" />
  <AddGroupDialog v-if="showAdd" @close="showAdd = false" />
</template>
