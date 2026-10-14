<script setup lang="ts">
import type { TagProps } from "naive-ui";
import { computed } from "vue";

import type { RecordItem } from "~/types/api";

const props = defineProps<{
  topic: Pick<
    RecordItem,
    | "mode"
    | "state"
    | "revision"
    | "generation"
    | "noteGeneration"
    | "lastSourceId"
    | "summaryTaskState"
  >;
}>();
const status = computed<{ label: string; type: TagProps["type"] }>(() => {
  const topic = props.topic;

  if (topic.summaryTaskState === "running") {
    return { label: "正在整理", type: "info" };
  }
  if (topic.summaryTaskState === "pending") {
    return { label: "排队中", type: "warning" };
  }
  if (topic.revision > 0 && topic.generation === topic.noteGeneration) {
    return { label: "已整理", type: "success" };
  }
  if (topic.summaryTaskState === "failed") {
    return { label: "整理失败", type: "error" };
  }
  if (topic.lastSourceId === 0) {
    return { label: "暂无原文", type: "default" };
  }

  return { label: topic.revision > 0 ? "待更新" : "待整理", type: "default" };
});
</script>

<template>
  <span class="record-status">
    <NTag :bordered="false" round size="small" :type="status.type">
      {{ status.label }}
    </NTag>
    <small v-if="topic.mode === 'manual' && topic.state === 'active'">
      持续记录
    </small>
  </span>
</template>

<style scoped>
.record-status {
  display: inline-flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 4px;
  vertical-align: middle;
}

small {
  color: #798899;
  font-size: 11px;
}
</style>
