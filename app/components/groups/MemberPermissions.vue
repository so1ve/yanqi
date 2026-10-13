<script setup lang="ts">
import { Users } from "@vicons/tabler";
import type { DataTableColumns, DataTableRowKey } from "naive-ui";
import { NTag } from "naive-ui";
import { computed, h, ref } from "vue";

import UserAvatar from "~/components/UserAvatar.vue";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { positiveInteger, useQueryValue } from "~/composables/useQueryValue";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Group, Member } from "~/types/api";
import { api } from "~/utils/api";

const props = defineProps<{ group: Group }>();
const workspace = useWorkspace();
const { busy, run } = useAction();

const admins = ref([...props.group.admins]);
const {
  data: members,
  loading,
  error,
  refresh: refreshMembers,
} = useApiData<Member[]>(() => `groups/${props.group.id}/members`);
const checked = computed(() => [
  ...new Set([
    ...admins.value,
    ...(members.value ?? [])
      .filter((member) => member.inherited)
      .map((member) => member.id),
  ]),
]);
const memberQuery = useQueryValue("q", (value) => value ?? "", {
  replace: true,
  reset: ["page"],
});
const memberPage = useQueryValue(
  "page",
  (value) => positiveInteger(value) ?? 1,
);
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

const memberColumns: DataTableColumns<Member> = [
  { type: "selection", disabled: (row) => row.inherited },
  {
    title: "成员",
    key: "name",
    render: (row) =>
      h("div", { class: "member-cell" }, [
        h(UserAvatar, { userId: row.id, name: row.name, size: 32 }),
        h("div", [row.name, h("div", { class: "cell-sub mono" }, row.id)]),
      ]),
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
            ({ owner: "群主", admin: "管理员", member: "成员" })[
              row.role ?? "member"
            ],
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

async function save(): Promise<void> {
  await run(async () => {
    await api(`groups/${props.group.id}/settings`, {
      method: "PUT",
      body: { admins: admins.value },
    });
    await workspace.refresh();
  }, "交互名单已保存");
}
</script>

<template>
  <PageHeading
    :description="`${props.group.name} · 群主、群管理员和全局管理员已有交互权限，勾选可授权其他成员`"
    title="群成员"
  >
    <NButton
      :disabled="loading || !!error"
      :loading="busy"
      type="primary"
      @click="save"
    >
      保存名单
    </NButton>
    <template #toolbar>
      <ListToolbar>
        <NInput
          v-model:value="memberQuery"
          class="search"
          clearable
          placeholder="搜索昵称或 QQ 号"
        >
          <template #prefix><NIcon :component="Users" /></template>
        </NInput>
      </ListToolbar>
    </template>
  </PageHeading>
  <LoadState :error :loading @retry="refreshMembers">
    <AppPanel>
      <NDataTable
        :checked-row-keys="checked"
        :columns="memberColumns"
        :data="filteredMembers"
        :pagination="{ page: memberPage, pageSize: 15 }"
        :row-key="(row: Member) => row.id"
        :scroll-x="600"
        @update:checked-row-keys="select"
        @update:page="memberPage = $event"
      />
    </AppPanel>
  </LoadState>
</template>

<style scoped>
:deep(.member-cell) {
  display: flex;
  align-items: center;
  gap: 10px;
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
</style>
