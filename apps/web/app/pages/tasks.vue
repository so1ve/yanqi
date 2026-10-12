<script setup lang="ts">
import { Refresh } from "@vicons/tabler";
import type { DataTableColumns } from "naive-ui";
import { NButton, useDialog } from "naive-ui";
import { computed, h, ref, watch } from "vue";

import StateTag from "~/components/StateTag.vue";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { usePoll } from "~/composables/usePoll";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Delivery, Page, Task } from "~/types/api";
import { api, formatTime, kindNames } from "~/utils/api";

const { groupId, group, status } = useWorkspace();
const page = ref(1);
const tab = ref("tasks");
const state = ref("");
watch([groupId, state, tab], () => {
  page.value = 1;
});
const taskData = useApiData<Page<Task>>(() =>
  groupId.value && tab.value === "tasks"
    ? `groups/${groupId.value}/tasks?page=${page.value}${state.value ? `&state=${state.value}` : ""}`
    : "",
);
const deliveryData = useApiData<Page<Delivery>>(() =>
  groupId.value && tab.value === "deliveries"
    ? `groups/${groupId.value}/deliveries?page=${page.value}`
    : "",
);
const { data: tasks, loading: tasksLoading, error: tasksError } = taskData;
const {
  data: deliveries,
  loading: deliveriesLoading,
  error: deliveriesError,
} = deliveryData;
async function refresh(): Promise<void> {
  await (tab.value === "tasks" ? taskData : deliveryData).refresh();
}
usePoll(refresh);
const { busy, run } = useAction();
const dialog = useDialog();
const detailId = ref<number | null>(null);
const detail = computed(() =>
  tasks.value?.items.find((task) => task.id === detailId.value),
);
async function retry(task: Task): Promise<void> {
  await run(async () => {
    await api(`groups/${groupId.value}/tasks/${task.id}/retry`, {
      method: "POST",
    });
    await refresh();
  }, "已重新安排任务");
}
function cancel(id: number, kind: "tasks" | "deliveries"): void {
  dialog.warning({
    title: "取消这项任务？",
    content:
      kind === "tasks"
        ? "已保存的消息和附件会保留。"
        : "这条群消息将不会发送。",
    positiveText: "取消任务",
    negativeText: "返回",
    onPositiveClick: () =>
      run(async () => {
        await api(`groups/${groupId.value}/${kind}/${id}/cancel`, {
          method: "POST",
        });
        await refresh();
      }, "已取消"),
  });
}
const columns: DataTableColumns<Task> = [
  {
    title: "任务",
    key: "id",
    width: 95,
    render: (row) =>
      h(
        NButton,
        {
          text: true,
          type: "primary",
          onClick: () => {
            detailId.value = row.id;
          },
        },
        { default: () => `#${row.id}` },
      ),
  },
  {
    title: "类型",
    key: "kind",
    width: 125,
    render: (row) => kindNames[row.kind] ?? row.kind,
  },
  {
    title: "进度 / 错误",
    key: "progress",
    minWidth: 260,
    render: (row) =>
      h("div", [
        h(
          "div",
          {
            style: row.lastError
              ? "color: #bf655d; overflow-wrap: anywhere"
              : "overflow-wrap: anywhere",
          },
          row.lastError || row.progress || "等待领取",
        ),
        h(
          "div",
          { class: "cell-sub" },
          `已尝试 ${row.attempts} 次${row.state === "pending" ? ` · 计划 ${formatTime(row.runAfter)}` : ""}`,
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
    title: "操作",
    key: "actions",
    width: 145,
    render: (row) =>
      h("div", { class: "row-actions" }, [
        !["intent", "observe"].includes(row.kind) &&
        ["done", "failed"].includes(row.state)
          ? h(
              NButton,
              {
                size: "small",
                disabled: busy.value,
                onClick: () => retry(row),
              },
              { default: () => "重试" },
            )
          : null,
        row.state === "pending" || row.state === "failed"
          ? h(
              NButton,
              {
                size: "small",
                disabled: busy.value,
                onClick: () => cancel(row.id, "tasks"),
              },
              { default: () => "取消" },
            )
          : null,
      ]),
  },
];
const deliveryColumns: DataTableColumns<Delivery> = [
  { title: "编号", key: "id", width: 80, render: (row) => `#${row.id}` },
  {
    title: "内容",
    key: "content",
    minWidth: 300,
    render: (row) =>
      row.kind === "note" ? `纪要全文 · #${row.noteId}` : row.content,
  },
  {
    title: "状态",
    key: "state",
    width: 110,
    render: (row) => h(StateTag, { state: row.state }),
  },
  {
    title: "创建时间",
    key: "createdAt",
    width: 160,
    render: (row) => formatTime(row.createdAt),
  },
  {
    title: "操作",
    key: "actions",
    width: 90,
    render: (row) =>
      row.state === "pending"
        ? h(
            NButton,
            {
              size: "small",
              disabled: busy.value || status.value?.running,
              onClick: () => cancel(row.id, "deliveries"),
            },
            { default: () => "取消" },
          )
        : null,
  },
];
const states = [
  { label: "全部状态", value: "" },
  { label: "等待处理", value: "pending" },
  { label: "正在处理", value: "running" },
  { label: "失败", value: "failed" },
  { label: "已完成", value: "done" },
];
</script>

<template>
  <PageHeading
    :description="`${group?.name ?? '选择一个群'} · 查看整理、解析和发送的进度`"
    title="后台任务"
  >
    <NButton :loading="tasksLoading || deliveriesLoading" @click="refresh">
      <template #icon><NIcon :component="Refresh" /></template>
      刷新
    </NButton>
  </PageHeading>
  <NTabs v-model:value="tab" type="line">
    <NTabPane name="tasks" tab="处理任务">
      <div class="toolbar">
        <NSelect v-model:value="state" class="filter-state" :options="states" />
        <span class="muted">自动更新 · 每 5 秒</span>
      </div>
      <LoadState
        description="记录请求、附件解析和纪要整理会显示在这里。"
        :empty="!tasks?.items.length"
        :error="tasksError"
        :loading="tasksLoading && !tasks"
        title="当前没有任务"
        @retry="refresh"
      >
        <div class="panel">
          <NDataTable
            :bordered="false"
            :columns
            :data="tasks?.items ?? []"
            :scroll-x="750"
          />
        </div>
        <div class="pagination">
          <span>共 {{ tasks?.total }} 项</span>
          <NPagination
            v-model:page="page"
            :item-count="tasks?.total ?? 0"
            :page-size="30"
          />
        </div>
      </LoadState>
      <p class="form-help">
        旧对话不会重放，避免重复执行群里的请求。要中断正在执行的任务，请停止机器人。
      </p>
    </NTabPane>
    <NTabPane name="deliveries" tab="群消息发送">
      <LoadState
        :empty="!deliveries?.items.length"
        :error="deliveriesError"
        :loading="deliveriesLoading && !deliveries"
        title="还没有发送记录"
        @retry="refresh"
      >
        <div class="panel">
          <NDataTable
            :bordered="false"
            :columns="deliveryColumns"
            :data="deliveries?.items ?? []"
            :scroll-x="700"
          />
        </div>
        <div class="pagination">
          <span>共 {{ deliveries?.total }} 条</span>
          <NPagination
            v-model:page="page"
            :item-count="deliveries?.total ?? 0"
            :page-size="30"
          />
        </div>
      </LoadState>
      <p class="form-help">
        停止机器人后，可以取消尚未发送的消息。已经发出的消息不能在这里撤回。
      </p>
    </NTabPane>
  </NTabs>
  <NDrawer
    :show="detailId !== null"
    width="min(480px, 100vw)"
    @update:show="detailId = null"
  >
    <NDrawerContent closable :title="`任务 #${detailId}`">
      <template v-if="detail">
        <NDescriptions bordered :column="1" label-placement="top">
          <NDescriptionsItem label="类型">
            {{ kindNames[detail.kind] }}
          </NDescriptionsItem>
          <NDescriptionsItem label="状态">
            <StateTag :state="detail.state" />
          </NDescriptionsItem>
          <NDescriptionsItem label="进度">
            {{ detail.progress || "暂无进度说明" }}
          </NDescriptionsItem>
          <NDescriptionsItem label="最近错误">
            {{ detail.lastError || "无" }}
          </NDescriptionsItem>
          <NDescriptionsItem label="处理对象">
            <pre class="pre-wrap">{{
              JSON.stringify(detail.payload, null, 2)
            }}</pre>
          </NDescriptionsItem>
        </NDescriptions>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>
