<script setup lang="ts">
import { Plus, Refresh, Search } from "@vicons/tabler";
import type { DataTableColumns } from "naive-ui";
import { computed, h, ref, watch } from "vue";

import { NuxtLink } from "#components";
import CreateDialog from "~/components/records/CreateDialog.vue";
import RecordStatus from "~/components/records/RecordStatus.vue";
import { useApiData } from "~/composables/useApiData";
import { positiveInteger, useQueryValue } from "~/composables/useQueryValue";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Page, RecordItem } from "~/types/api";
import { formatTime } from "~/utils/format";

const { groupId, group } = useWorkspace();
const view = useQueryValue(
  "view",
  (value) => (value === "drafts" ? "drafts" : "notes"),
  { reset: ["page"] },
);
const searchQuery = useQueryValue("q", (value) => value ?? "", {
  reset: ["page"],
});
const query = ref(searchQuery.value);
const page = useQueryValue("page", (value) => positiveInteger(value) ?? 1);
watch(searchQuery, (value) => {
  query.value = value;
});
const { data, error, loading, refresh } = useApiData<Page<RecordItem>>(
  () =>
    `groups/${groupId.value}/records?view=${view.value}&page=${page.value}&q=${encodeURIComponent(searchQuery.value)}`,
);
const columns = computed<DataTableColumns<RecordItem>>(() => [
  {
    title: view.value === "drafts" ? "讨论草稿" : "纪要",
    key: "title",
    minWidth: 270,
    render: (row) =>
      h("div", [
        h(
          NuxtLink,
          { to: `/${row.groupId}/records/${row.id}` },
          { default: () => row.title },
        ),
        h(
          "div",
          { class: "cell-sub" },
          row.description || row.focus || "暂无简介",
        ),
      ]),
  },
  {
    title: "整理状态",
    key: "summaryTaskState",
    width: 120,
    render: (row) => h(RecordStatus, { topic: row }),
  },
  {
    title: "版本",
    key: "revision",
    width: 95,
    render: (row) =>
      row.mode === "auto"
        ? "—"
        : row.revision
          ? `第 ${row.revision} 版`
          : "待生成",
  },
  {
    title: "最近讨论",
    key: "lastActiveAt",
    width: 160,
    render: (row) => formatTime(row.lastActiveAt),
  },
]);
const createGroupId = ref("");
</script>

<template>
  <PageHeading
    :description="`${group?.name ?? groupId} · ${view === 'drafts' ? '自动留存讨论线索，需要时再生成纪要' : '每篇纪要都保留原文和历史版本'}`"
    title="纪要"
  >
    <NButton :loading @click="refresh">
      <template #icon><NIcon :component="Refresh" /></template>
      刷新
    </NButton>
    <NButton type="primary" @click="createGroupId = groupId">
      <template #icon><NIcon :component="Plus" /></template>
      新建纪要
    </NButton>
    <template #toolbar>
      <ListToolbar as="form" @submit.prevent="searchQuery = query">
        <NRadioGroup v-model:value="view" aria-label="纪要列表类型">
          <NRadioButton value="notes">正式纪要</NRadioButton>
          <NRadioButton value="drafts">讨论草稿</NRadioButton>
        </NRadioGroup>
        <NInput
          v-model:value="query"
          class="search"
          clearable
          placeholder="搜索标题、简介或整理要求"
        >
          <template #prefix><NIcon :component="Search" /></template>
        </NInput>
        <NButton attr-type="submit">搜索</NButton>
        <span class="right muted">{{ data?.total ?? 0 }} 篇</span>
      </ListToolbar>
    </template>
  </PageHeading>
  <LoadState
    :description="
      view === 'drafts'
        ? '小栖自动留存的讨论简介和原文会显示在这里，明确要求后才生成正式纪要。'
        : '可以在群里让小栖整理讨论，也可以点击“新建纪要”选择已保存的消息。'
    "
    :empty="!data?.items.length"
    :error
    :loading="loading && !data"
    :title="
      searchQuery
        ? '没有找到匹配的内容'
        : view === 'drafts'
          ? '还没有讨论草稿'
          : '还没有正式纪要'
    "
    @retry="refresh"
  >
    <AppPanel>
      <NDataTable
        :bordered="false"
        :columns
        :data="data?.items ?? []"
        :row-key="(row: RecordItem) => row.id"
        :scroll-x="700"
      />
    </AppPanel>
    <ListPagination v-model:page="page" :total="data?.total ?? 0">
      共 {{ data?.total }} 篇 · 每页 30 篇
    </ListPagination>
  </LoadState>
  <CreateDialog
    v-if="createGroupId"
    :group-id="createGroupId"
    @close="createGroupId = ''"
  />
</template>

<style scoped>
.muted {
  color: #798899;
}

:deep(.cell-sub) {
  color: #8a97a7;
  font-size: 11px;
  margin-top: 4px;
}
</style>
