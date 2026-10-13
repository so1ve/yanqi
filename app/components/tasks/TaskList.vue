<script setup lang="ts">
import type { DataTableColumns } from "naive-ui";
import { NButton, useDialog } from "naive-ui";
import { computed, h, ref, watch } from "vue";

import StateTag from "~/components/StateTag.vue";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { usePoll } from "~/composables/usePoll";
import type { Page, Task } from "~/types/api";
import { api } from "~/utils/api";
import { formatTime } from "~/utils/format";
import { kindNames } from "~/utils/labels";

const props = defineProps<{ groupId: string }>();
const page = ref(1);
const state = ref("");
const detailId = ref<number | null>(null);
const {
  data: tasks,
  loading: tasksLoading,
  error: tasksError,
  refresh,
} = useApiData<Page<Task>>(() =>
  props.groupId
    ? `groups/${props.groupId}/tasks?page=${page.value}&state=${state.value}`
    : "",
);
const detail = computed(() =>
  tasks.value?.items.find((task) => task.id === detailId.value),
);
const { busy, run } = useAction();
const dialog = useDialog();

watch([() => props.groupId, state], () => {
  page.value = 1;
  detailId.value = null;
});
usePoll(refresh);

async function retry(task: Task): Promise<void> {
  await run(async () => {
    await api(`groups/${task.payload.groupId}/tasks/${task.id}/retry`, {
      method: "POST",
    });
    await refresh();
  }, "已安排重试");
}

function cancel(task: Task): void {
  dialog.warning({
    title: "取消这项任务？",
    content: "已保存的消息和附件会保留。",
    positiveText: "取消任务",
    negativeText: "返回",
    onPositiveClick: () =>
      run(async () => {
        await api(`groups/${task.payload.groupId}/tasks/${task.id}/cancel`, {
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
          row.lastError || row.progress || "暂无进度说明",
        ),
        h(
          "div",
          { class: "cell-sub" },
          `已尝试 ${row.attempts} 次${row.state === "pending" ? ` · 最早于 ${formatTime(row.runAfter)} 开始` : ""}`,
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
                onClick: () => cancel(row),
              },
              { default: () => "取消" },
            )
          : null,
      ]),
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
  <ListToolbar>
    <NSelect v-model:value="state" class="filter-state" :options="states" />
    <span class="muted">每 5 秒刷新</span>
    <NButton class="right" :loading="tasksLoading" @click="refresh">
      刷新
    </NButton>
  </ListToolbar>
  <LoadState
    description="对话请求、附件解析和纪要整理会显示在这里。"
    :empty="!tasks?.items.length"
    :error="tasksError"
    :loading="tasksLoading && !tasks"
    :title="!groupId ? '请先选择一个群' : '没有符合条件的任务'"
    @retry="refresh"
  >
    <AppPanel>
      <NDataTable
        :bordered="false"
        :columns
        :data="tasks?.items ?? []"
        :scroll-x="750"
      />
    </AppPanel>
    <ListPagination v-model:page="page" :total="tasks?.total ?? 0">
      共 {{ tasks?.total }} 项
    </ListPagination>
  </LoadState>
  <p class="form-help">
    对话请求不能重试，请在群里重新提出。要中断正在执行的任务，请暂停 AI。
  </p>
  <NDrawer
    :show="!!detail"
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

<style scoped>
.muted {
  color: #798899;
}

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

.form-help {
  font-size: 12px;
  color: #8a97a7;
  margin-top: 7px;
}

.pre-wrap {
  white-space: pre-wrap;
}

.filter-state {
  width: 165px;
}
</style>
