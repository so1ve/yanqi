<script setup lang="ts">
import { Plus, Refresh, Search } from "@vicons/tabler";
import type { Topic } from "@yanqi/bot";
import type { DataTableColumns } from "naive-ui";
import { computed, h, ref, watch } from "vue";

import { navigateTo } from "#imports";
import StateTag from "~/components/StateTag.vue";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Page } from "~/types/api";
import { api, formatTime } from "~/utils/api";

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
const columns = computed<DataTableColumns<Topic>>(() => [
  {
    title: "纪要",
    key: "title",
    minWidth: 270,
    render: (row) =>
      h("div", [
        h(
          "a",
          {
            href: `/records/${row.id}?group=${row.groupId}`,
            onClick: (event: MouseEvent) => {
              event.preventDefault();
              void navigateTo(`/records/${row.id}?group=${row.groupId}`);
            },
          },
          row.title,
        ),
        h(
          "div",
          { class: "cell-sub" },
          row.description || row.focus || "等待整理讨论内容",
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
]);
const showCreate = ref(false);
const title = ref("");
const focus = ref("");
const scope = ref<"all" | "range">("all");
const range = ref<[number, number] | null>(null);
const { busy, run } = useAction();
async function create(): Promise<void> {
  await run(async () => {
    const result = await api<{ topic: Topic }>(
      `groups/${groupId.value}/records`,
      {
        method: "POST",
        body: {
          title: title.value,
          focus: focus.value,
          ...(scope.value === "range" && range.value
            ? { from: range.value[0], to: range.value[1] }
            : {}),
        },
      },
    );
    showCreate.value = false;
    await navigateTo(`/records/${result.topic.id}?group=${groupId.value}`);
  }, "已安排整理，完成后会保存在这里");
}
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
    <NButton :disabled="!groupId" type="primary" @click="showCreate = true">
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
    description="在群里让小栖记录，或从已保存的历史消息中创建一篇。"
    :empty="!groupId || !data?.items.length"
    :error
    :loading="loading && !data"
    title="这里还没有纪要"
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
  <NModal
    v-model:show="showCreate"
    class="modal-record"
    preset="card"
    title="从原始消息创建纪要"
  >
    <NForm @submit.prevent="create">
      <NFormItem label="标题">
        <NInput v-model:value="title" placeholder="例如：部署方案讨论" />
      </NFormItem>
      <NFormItem label="整理要求">
        <NInput
          v-model:value="focus"
          :autosize="{ minRows: 3, maxRows: 8 }"
          placeholder="需要关注哪些问题、结论或建议？留空则整理全部内容。"
          type="textarea"
        />
      </NFormItem>
      <NFormItem label="原文范围">
        <NRadioGroup v-model:value="scope">
          <NSpace>
            <NRadio value="all">全部已保存消息</NRadio>
            <NRadio value="range">指定时间</NRadio>
          </NSpace>
        </NRadioGroup>
      </NFormItem>
      <NFormItem v-if="scope === 'range'" label="开始与结束时间">
        <NDatePicker
          v-model:value="range"
          class="w-full"
          type="datetimerange"
        />
      </NFormItem>
      <p class="form-help">
        完成后仅在本地保存。机器人暂停时，任务会等启动后执行。
      </p>
      <NSpace class="mt-24" justify="end">
        <NButton @click="showCreate = false">取消</NButton>
        <NButton
          attr-type="submit"
          :disabled="!title.trim() || (scope === 'range' && !range)"
          :loading="busy"
          type="primary"
        >
          开始整理
        </NButton>
      </NSpace>
    </NForm>
  </NModal>
</template>
