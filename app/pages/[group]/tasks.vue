<script setup lang="ts">
import { computed, useTemplateRef } from "vue";

import DeliveryList from "~/components/tasks/DeliveryList.vue";
import TaskList from "~/components/tasks/TaskList.vue";
import { useQueryValue } from "~/composables/useQueryValue";
import { useWorkspace } from "~/composables/useWorkspace";

const { groupId, group } = useWorkspace();
const tab = useQueryValue(
  "tab",
  (value) => (value === "deliveries" ? "deliveries" : "tasks"),
  { reset: ["page", "task"] },
);
const state = useQueryValue(
  "state",
  (value) =>
    value && ["done", "failed", "pending", "running"].includes(value)
      ? value
      : "",
  { reset: ["page", "task"] },
);
const tasks = useTemplateRef<InstanceType<typeof TaskList>>("tasks");
const deliveries =
  useTemplateRef<InstanceType<typeof DeliveryList>>("deliveries");
const activeList = computed(() =>
  tab.value === "tasks" ? tasks.value : deliveries.value,
);
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
    :description="`${group?.name ?? groupId} · 查看进度、错误和发送状态`"
    title="后台任务"
  >
    <NButton :loading="activeList?.loading" @click="activeList?.refresh()">
      刷新
    </NButton>
    <template #toolbar>
      <ListToolbar>
        <NSelect
          v-if="tab === 'tasks'"
          v-model:value="state"
          class="filter-state"
          :options="states"
        />
        <span class="muted">每 5 秒刷新</span>
      </ListToolbar>
    </template>
  </PageHeading>
  <PageTabs v-model:value="tab">
    <NTabPane name="tasks" tab="处理任务">
      <TaskList v-if="tab === 'tasks'" ref="tasks" :group-id :state />
    </NTabPane>
    <NTabPane name="deliveries" tab="群消息发送">
      <DeliveryList v-if="tab === 'deliveries'" ref="deliveries" :group-id />
    </NTabPane>
  </PageTabs>
</template>

<style scoped>
.muted {
  color: #798899;
}

.filter-state {
  width: 165px;
}
</style>
