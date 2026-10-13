<script setup lang="ts">
import { ref } from "vue";

import DeliveryList from "~/components/tasks/DeliveryList.vue";
import TaskList from "~/components/tasks/TaskList.vue";
import { useWorkspace } from "~/composables/useWorkspace";

const { groupId, group } = useWorkspace();
const tab = ref("tasks");
</script>

<template>
  <PageHeading
    :description="`${group?.name ?? '请先选择一个群'} · 查看进度、错误和发送状态`"
    title="后台任务"
  />
  <NTabs v-model:value="tab" type="line">
    <NTabPane name="tasks" tab="处理任务">
      <TaskList v-if="tab === 'tasks'" :group-id />
    </NTabPane>
    <NTabPane name="deliveries" tab="群消息发送">
      <DeliveryList v-if="tab === 'deliveries'" :group-id />
    </NTabPane>
  </NTabs>
</template>
