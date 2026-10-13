<script setup lang="ts">
import { Plus, Search } from "@vicons/tabler";
import type { DataTableColumns } from "naive-ui";
import { NButton, useDialog } from "naive-ui";
import { computed, h, ref, watch } from "vue";

import MemoryDialog from "~/components/memories/MemoryDialog.vue";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { positiveInteger, useQueryValue } from "~/composables/useQueryValue";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Memory, Page } from "~/types/api";
import { api } from "~/utils/api";
import { formatTime } from "~/utils/format";

const props = defineProps<{ scope: Memory["scope"] }>();
const { groupId, group } = useWorkspace();
const page = useQueryValue("page", (value) => positiveInteger(value) ?? 1);
const searchQuery = useQueryValue("q", (value) => value ?? "", {
  reset: ["page"],
});
const query = ref(searchQuery.value);
watch(searchQuery, (value) => {
  query.value = value;
});
const { data, loading, error, refresh } = useApiData<Page<Memory>>(() => {
  const owner = props.scope === "group" ? `&ownerId=${groupId.value}` : "";

  return `memories?scope=${props.scope}${owner}&page=${page.value}&q=${encodeURIComponent(searchQuery.value)}`;
});
const editor = ref<{
  groupId: string;
  scope: Memory["scope"];
  memory?: Memory;
} | null>(null);
const { run } = useAction();
const dialog = useDialog();

function edit(memory?: Memory): void {
  editor.value = { groupId: groupId.value, scope: props.scope, memory };
}

function remove(row: Memory): void {
  dialog.warning({
    title: "删除这条记忆？",
    content: row.key,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: () =>
      run(async () => {
        await api("memories", {
          method: "DELETE",
          body: { scope: row.scope, ownerId: row.ownerId, key: row.key },
        });
        await refresh();
      }, "已删除"),
  });
}
const columns = computed<DataTableColumns<Memory>>(() => [
  {
    title: props.scope === "group" ? "适用范围" : "成员 QQ 号",
    key: "ownerId",
    width: 135,
    render: (row) => (row.scope === "group" ? "本群共享" : row.ownerId),
  },
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
]);
</script>

<template>
  <PageHeading
    :description="
      scope === 'group'
        ? `${group?.name ?? groupId} · 本群共同的约定与长期信息`
        : '按 QQ 账号跨群使用的个人偏好，只影响与本人的交互'
    "
    :title="scope === 'group' ? '群共享记忆' : '个人偏好'"
  >
    <NButton type="primary" @click="edit()">
      <template #icon><NIcon :component="Plus" /></template>
      添加记忆
    </NButton>
    <template #toolbar>
      <ListToolbar as="form" @submit.prevent="searchQuery = query">
        <NInput
          v-model:value="query"
          class="search"
          clearable
          :placeholder="
            scope === 'group' ? '搜索内容或名称' : '搜索内容、名称或 QQ 号'
          "
        >
          <template #prefix><NIcon :component="Search" /></template>
        </NInput>
        <NButton attr-type="submit">搜索</NButton>
      </ListToolbar>
    </template>
  </PageHeading>
  <LoadState
    :description="
      scope === 'group'
        ? '向小栖说明本群的约定，它会在之后的判断和回复中使用。'
        : '在对话中告诉小栖你的偏好，也可以在这里添加。'
    "
    :empty="!data?.items.length"
    :error
    :loading="loading && !data"
    :title="searchQuery ? '没有找到匹配的记忆' : '还没有保存的记忆'"
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
    :scope="editor.scope"
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
