<script setup lang="ts">
import { Plus, Refresh, Users } from "@vicons/tabler";
import type { DataTableColumns, DataTableRowKey } from "naive-ui";
import { NButton, NSwitch, NTag } from "naive-ui";
import { computed, h, ref } from "vue";

import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Group, Member } from "~/types/api";
import { api, formatNumber } from "~/utils/api";

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
const admins = ref<string[]>([]);
const showMembers = ref(false);
const {
  data: members,
  loading,
  error,
  refresh: refreshMembers,
} = useApiData<Member[]>(() =>
  showMembers.value && active.value ? `groups/${active.value.id}/members` : "",
);
const checked = computed(() => [
  ...new Set([
    ...admins.value,
    ...(members.value ?? [])
      .filter((member) => member.inherited)
      .map((member) => member.id),
  ]),
]);
const memberQuery = ref("");
const filteredMembers = computed(
  () =>
    members.value?.filter((member) =>
      `${member.name} ${member.nickname} ${member.id}`.includes(
        memberQuery.value,
      ),
    ) ?? [],
);
function select(keys: DataTableRowKey[]): void {
  admins.value = keys
    .map(String)
    .filter(
      (id) => !members.value?.find((member) => member.id === id)?.inherited,
    );
}
function edit(group: Group): void {
  active.value = group;
  admins.value = [...group.admins];
  memberQuery.value = "";
  showMembers.value = true;
}
const update = async (
  group: Group,
  changes: Partial<Pick<Group, "enabled" | "automatic" | "admins">>,
): Promise<boolean> =>
  run(async () => {
    await api(`groups/${group.id}/settings`, {
      method: "PUT",
      body: {
        enabled: group.enabled,
        automatic: group.automatic,
        admins: group.admins,
        ...changes,
      },
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
          onClick: () => edit(row),
        },
        { default: () => "管理成员" },
      ),
  },
];
const memberColumns: DataTableColumns<Member> = [
  { type: "selection", disabled: (row) => row.inherited },
  {
    title: "成员",
    key: "name",
    render: (row) =>
      h("div", [row.name, h("div", { class: "cell-sub mono" }, row.id)]),
  },
  {
    title: "群内身份",
    key: "role",
    width: 100,
    render: (row) =>
      h(
        NTag,
        {
          bordered: false,
          size: "small",
          type:
            row.role === "owner"
              ? "warning"
              : row.role === "admin"
                ? "info"
                : "default",
        },
        {
          default: () =>
            ({ owner: "群主", admin: "管理员", member: "成员" })[row.role] ??
            row.role,
        },
      ),
  },
  {
    title: "授权来源",
    key: "inherited",
    width: 130,
    render: (row) => (row.inherited ? "群身份 / 全局名单" : "本群名单"),
  },
];
const showAdd = ref(false);
const newId = ref("");
async function add(): Promise<void> {
  if (
    await run(async () => {
      await api(`groups/${newId.value}/settings`, {
        method: "PUT",
        body: { enabled: true, automatic: true, admins: [] },
      });
      await workspace.refresh();
    }, "群已添加")
  ) {
    showAdd.value = false;
  }
}
async function saveMembers(): Promise<void> {
  if (active.value && (await update(active.value, { admins: admins.value }))) {
    showMembers.value = false;
  }
}
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
  <NModal
    v-model:show="showMembers"
    class="modal-wide"
    preset="card"
    :title="`${active?.name ?? ''} · 交互权限`"
  >
    <p class="muted mb-18">
      群主、群管理员和全局管理员已有交互权限。勾选可授权其他成员。
    </p>
    <NInput
      v-model:value="memberQuery"
      class="mb-16"
      clearable
      placeholder="搜索昵称或 QQ 号"
    >
      <template #prefix><NIcon :component="Users" /></template>
    </NInput>
    <LoadState :error :loading @retry="refreshMembers">
      <NDataTable
        :checked-row-keys="checked"
        :columns="memberColumns"
        :data="filteredMembers"
        :max-height="420"
        :pagination="{ pageSize: 15 }"
        :row-key="(row: Member) => row.id"
        @update:checked-row-keys="select"
      />
    </LoadState>
    <NSpace class="mt-20" justify="end">
      <NButton @click="showMembers = false">取消</NButton>
      <NButton
        :disabled="loading || !!error"
        :loading="busy"
        type="primary"
        @click="saveMembers"
      >
        保存名单
      </NButton>
    </NSpace>
  </NModal>
  <NModal
    v-model:show="showAdd"
    class="modal-narrow"
    preset="card"
    title="添加记录群"
  >
    <NForm @submit.prevent="add">
      <NFormItem label="群号">
        <NInput v-model:value="newId" placeholder="机器人已加入的 QQ 群" />
      </NFormItem>
      <p class="form-help">请先让机器人 QQ 账号加入该群，再添加群号。</p>
      <NSpace class="mt-20" justify="end">
        <NButton @click="showAdd = false">取消</NButton>
        <NButton
          attr-type="submit"
          :disabled="!/^\d+$/.test(newId)"
          :loading="busy"
          type="primary"
        >
          添加
        </NButton>
      </NSpace>
    </NForm>
  </NModal>
</template>
