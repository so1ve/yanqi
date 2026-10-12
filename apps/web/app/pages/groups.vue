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
    title: "自动归档",
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
    title: "群身份",
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
    description="按群启用记录，并选择可以和小栖交互的人。"
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
    连接 NapCat 后，可以同步群名称与成员。已有记录仍可查看。
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
    description="连接 NapCat 后同步，或直接填写一个群号。"
    :empty="filtered.length === 0"
    title="还没有记录群"
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
      停用“保存消息”后不再处理这个群的新消息。关闭“自动归档”仍会保存消息，并响应获准成员的请求。
    </p>
  </LoadState>
  <NModal
    v-model:show="showMembers"
    class="modal-wide"
    preset="card"
    :title="`${active?.name ?? ''} · 交互权限`"
  >
    <p class="muted mb-18">
      群主、QQ 群管理员和全局名单自动获准。勾选其他成员可加入本群名单。
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
      <p class="form-help">保存只会启用记录，不会让 QQ 账号自动加入这个群。</p>
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
