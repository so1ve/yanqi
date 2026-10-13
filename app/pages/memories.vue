<script setup lang="ts">
import { Plus, Search } from "@vicons/tabler";
import type { DataTableColumns } from "naive-ui";
import { NButton, useDialog } from "naive-ui";
import { h, ref, watch } from "vue";

import MemoryDialog from "~/components/memories/MemoryDialog.vue";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Memory, Page } from "~/types/api";
import { api } from "~/utils/api";
import { formatTime } from "~/utils/format";

const { groupId, group } = useWorkspace();
const page = ref(1);
const query = ref("");
const searchQuery = ref("");
watch([groupId, searchQuery], () => {
  page.value = 1;
});
const { data, loading, error, refresh } = useApiData<Page<Memory>>(() =>
  groupId.value
    ? `groups/${groupId.value}/memories?page=${page.value}&q=${encodeURIComponent(searchQuery.value)}`
    : "",
);
const editor = ref<{ groupId: string; memory?: Memory } | null>(null);
const { run } = useAction();
const dialog = useDialog();

function edit(memory?: Memory): void {
  editor.value = { groupId: memory?.groupId ?? groupId.value, memory };
}

function remove(row: Memory): void {
  dialog.warning({
    title: "删除这条记忆？",
    content: row.key,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: () =>
      run(async () => {
        await api(`groups/${row.groupId}/memories`, {
          method: "DELETE",
          body: { userId: row.userId, key: row.key },
        });
        await refresh();
      }, "已删除"),
  });
}
const columns: DataTableColumns<Memory> = [
  { title: "成员", key: "userId", width: 135 },
  {
    title: "记忆",
    key: "key",
    minWidth: 300,
    render: (row) =>
      h("div", [
        h("strong", row.key),
        h(
          "p",
          {
            class: "cell-sub",
            style: "white-space: pre-wrap; font-size: 13px; color: #68788b",
          },
          row.content,
        ),
      ]),
  },
  {
    title: "更新",
    key: "updatedAt",
    width: 165,
    render: (row) =>
      h("div", [
        formatTime(row.updatedAt),
        h(
          "p",
          { class: "cell-sub" },
          row.sourceMessageId === null
            ? "管理台编辑"
            : `来自消息 m${row.sourceMessageId}`,
        ),
      ]),
  },
  {
    title: "操作",
    key: "actions",
    width: 135,
    render: (row) =>
      h("div", { class: "row-actions" }, [
        h(
          NButton,
          { size: "small", onClick: () => edit(row) },
          { default: () => "编辑" },
        ),
        h(
          NButton,
          {
            size: "small",
            type: "error",
            quaternary: true,
            onClick: () => remove(row),
          },
          { default: () => "删除" },
        ),
      ]),
  },
];
</script>

<template>
  <PageHeading
    :description="`${group?.name ?? '请先选择一个群'} · 查看和编辑成员的偏好与约定`"
    title="记忆"
  >
    <NButton :disabled="!groupId" type="primary" @click="edit()">
      <template #icon><NIcon :component="Plus" /></template>
      添加记忆
    </NButton>
    <template #toolbar>
      <ListToolbar as="form" @submit.prevent="searchQuery = query">
        <NInput
          v-model:value="query"
          class="search"
          clearable
          placeholder="搜索内容、名称或 QQ 号"
        >
          <template #prefix><NIcon :component="Search" /></template>
        </NInput>
        <NButton attr-type="submit">搜索</NButton>
      </ListToolbar>
    </template>
  </PageHeading>
  <LoadState
    description="可以让小栖记住你的偏好，也可以在这里添加。"
    :empty="!data?.items.length"
    :error
    :loading="loading && !data"
    :title="
      !groupId
        ? '请先选择一个群'
        : searchQuery
          ? '没有找到匹配的记忆'
          : '还没有保存的记忆'
    "
    @retry="refresh"
  >
    <AppPanel>
      <NDataTable
        :bordered="false"
        :columns
        :data="data?.items ?? []"
        :scroll-x="700"
      />
    </AppPanel>
    <ListPagination v-model:page="page" :total="data?.total ?? 0">
      共 {{ data?.total }} 条
    </ListPagination>
  </LoadState>
  <MemoryDialog
    v-if="editor"
    :group-id="editor.groupId"
    :memory="editor.memory"
    @close="editor = null"
    @saved="refresh"
  />
</template>

<style scoped>
:deep(.cell-sub) {
  color: #8a97a7;
  font-size: 11px;
  margin-top: 4px;
}

:deep(.row-actions) {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
