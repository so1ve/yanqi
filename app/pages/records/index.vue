<script setup lang="ts">
import { Plus, Refresh, Search } from "@vicons/tabler";
import type { Topic } from "@yanqi/bot";
import type { DataTableColumns } from "naive-ui";
import { h, ref, watch } from "vue";

import { NuxtLink } from "#components";
import StateTag from "~/components/StateTag.vue";
import CreateDialog from "~/components/records/CreateDialog.vue";
import { useApiData } from "~/composables/useApiData";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Page } from "~/types/api";
import { formatTime } from "~/utils/format";

const { groupId, group } = useWorkspace();
const query = ref("");
const searchQuery = ref("");
const page = ref(1);
const { data, error, loading, refresh } = useApiData<Page<Topic>>(() =>
  groupId.value
    ? `groups/${groupId.value}/records?page=${page.value}&q=${encodeURIComponent(searchQuery.value)}`
    : "",
);
watch([groupId, searchQuery], () => {
  page.value = 1;
});
const columns: DataTableColumns<Topic> = [
  {
    title: "纪要",
    key: "title",
    minWidth: 270,
    render: (row) =>
      h("div", [
        h(
          NuxtLink,
          { to: `/records/${row.id}?group=${row.groupId}` },
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
    title: "状态",
    key: "state",
    width: 110,
    render: (row) => h(StateTag, { state: row.state }),
  },
  {
    title: "版本",
    key: "revision",
    width: 95,
    render: (row) => (row.revision ? `第 ${row.revision} 版` : "待生成"),
  },
  {
    title: "最近讨论",
    key: "lastActiveAt",
    width: 160,
    render: (row) => formatTime(row.lastActiveAt),
  },
];
const createGroupId = ref("");
</script>

<template>
  <PageHeading
    :description="
      group
        ? `${group.name} · 每篇纪要都保留原文和历史版本`
        : '选择一个群，查看已整理的讨论'
    "
    title="纪要"
  >
    <NButton :loading @click="refresh">
      <template #icon><NIcon :component="Refresh" /></template>
      刷新
    </NButton>
    <NButton
      :disabled="!groupId"
      type="primary"
      @click="createGroupId = groupId"
    >
      <template #icon><NIcon :component="Plus" /></template>
      新建纪要
    </NButton>
  </PageHeading>
  <form class="toolbar" @submit.prevent="searchQuery = query">
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
  </form>
  <LoadState
    description="可以在群里让小栖整理讨论，也可以点击“新建纪要”选择已保存的消息。"
    :empty="!groupId || !data?.items.length"
    :error
    :loading="loading && !data"
    :title="
      !groupId
        ? '请先选择一个群'
        : searchQuery
          ? '没有找到匹配的纪要'
          : '还没有纪要'
    "
    @retry="refresh"
  >
    <div class="panel">
      <NDataTable
        :bordered="false"
        :columns
        :data="data?.items ?? []"
        :row-key="(row: Topic) => row.id"
        :scroll-x="700"
      />
    </div>
    <div class="pagination">
      <span>共 {{ data?.total }} 篇 · 每页 30 篇</span>
      <NPagination
        v-model:page="page"
        :item-count="data?.total ?? 0"
        :page-size="30"
      />
    </div>
  </LoadState>
  <CreateDialog
    v-if="createGroupId"
    :group-id="createGroupId"
    @close="createGroupId = ''"
  />
</template>
