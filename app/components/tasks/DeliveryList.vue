<script setup lang="ts">
import type { DataTableColumns } from "naive-ui";
import { NButton, useDialog } from "naive-ui";
import { h, ref, watch } from "vue";

import StateTag from "~/components/StateTag.vue";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { usePoll } from "~/composables/usePoll";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Delivery, Page } from "~/types/api";
import { api } from "~/utils/api";
import { formatTime } from "~/utils/format";

const props = defineProps<{ groupId: string }>();
const { status } = useWorkspace();
const page = ref(1);
const {
  data: deliveries,
  loading: deliveriesLoading,
  error: deliveriesError,
  refresh,
} = useApiData<Page<Delivery>>(() =>
  props.groupId ? `groups/${props.groupId}/deliveries?page=${page.value}` : "",
);
const { busy, run } = useAction();
const dialog = useDialog();

watch(
  () => props.groupId,
  () => {
    page.value = 1;
  },
);
usePoll(refresh);

function cancel(id: number): void {
  const path = `groups/${props.groupId}/deliveries/${id}/cancel`;

  dialog.warning({
    title: "取消发送？",
    content: "这条群消息将不会发送。",
    positiveText: "取消发送",
    negativeText: "返回",
    onPositiveClick: () =>
      run(async () => {
        await api(path, { method: "POST" });
        await refresh();
      }, "已取消"),
  });
}

const columns: DataTableColumns<Delivery> = [
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
              onClick: () => cancel(row.id),
            },
            { default: () => "取消" },
          )
        : null,
  },
];
</script>

<template>
  <ListToolbar>
    <span class="muted">每 5 秒刷新</span>
    <NButton class="right" :loading="deliveriesLoading" @click="refresh">
      刷新
    </NButton>
  </ListToolbar>
  <LoadState
    :empty="!deliveries?.items.length"
    :error="deliveriesError"
    :loading="deliveriesLoading && !deliveries"
    :title="!groupId ? '请先选择一个群' : '还没有发送记录'"
    @retry="refresh"
  >
    <AppPanel>
      <NDataTable
        :bordered="false"
        :columns
        :data="deliveries?.items ?? []"
        :scroll-x="700"
      />
    </AppPanel>
    <ListPagination v-model:page="page" :total="deliveries?.total ?? 0">
      共 {{ deliveries?.total }} 条
    </ListPagination>
  </LoadState>
  <p class="form-help">
    暂停 AI 后，可以取消尚未发送的消息。已经发出的消息不能在这里撤回。
  </p>
</template>

<style scoped>
.muted {
  color: #798899;
}

.form-help {
  font-size: 12px;
  color: #8a97a7;
  margin-top: 7px;
}
</style>
