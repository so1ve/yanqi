<script setup lang="ts">
import { useMessage } from "naive-ui";
import { computed, onScopeDispose, ref } from "vue";

import { useAction } from "~/composables/useAction";
import { useWorkspace } from "~/composables/useWorkspace";
import type { ResourceItem } from "~/types/api";
import { api } from "~/utils/api";

const emit = defineEmits<{ updated: [] }>();
const props = defineProps<{
  asset: Pick<
    ResourceItem,
    "id" | "kind" | "state" | "previewable" | "downloadable" | "interpretation"
  > & {
    taskState?: ResourceItem["taskState"];
  };
  groupId: string;
}>();
const { run } = useAction();
const { status } = useWorkspace();
const message = useMessage();
const processing = ref(false);
const queued = computed(
  () =>
    props.asset.taskState === "pending" || props.asset.taskState === "running",
);
const label = computed(() => {
  const asset = props.asset;

  if (processing.value || queued.value) {
    return status.value?.running === false ||
      (!processing.value && asset.taskState === "pending")
      ? "等待处理"
      : "正在处理";
  }
  if (!asset.downloadable) {
    return asset.state === "missing" || asset.state === "failed"
      ? "重新获取"
      : "获取资源";
  }
  if (asset.previewable || asset.kind === "image") {
    return asset.interpretation ? "重新识别" : "识别图片";
  }
  if (asset.kind === "audio") {
    return asset.interpretation ? "重新转写" : "重新处理";
  }

  return asset.kind === "forward" ? "重新读取" : "重新下载";
});
let stream: EventSource | undefined;
let disposed = false;

onScopeDispose(() => {
  disposed = true;
  stream?.close();
});

async function retry() {
  if (processing.value || queued.value) {
    return;
  }

  processing.value = true;
  const path = `groups/${props.groupId}/assets/${props.asset.id}`;
  const submitted = await run(
    () => api(`${path}/retry`, { method: "POST" }),
    status.value?.running === false
      ? "已加入队列，恢复 AI 处理后继续"
      : "已开始处理，失败时保留原有结果",
  );

  if (!submitted || disposed) {
    processing.value = false;

    return;
  }

  emit("updated");
  stream = new EventSource(`/api/${path}/events`);
  stream.addEventListener("finished", (event) => {
    const result = JSON.parse(event.data) as { error: string | null };

    stream?.close();
    processing.value = false;
    if (result.error) {
      message.error(result.error);
    } else {
      message.success("资源处理完成");
    }
    emit("updated");
  });
  stream.onerror = () => {
    stream?.close();
    processing.value = false;
    message.warning("状态连接已断开，可点击刷新状态查看结果");
    emit("updated");
  };
}
</script>

<template>
  <NButton
    :disabled="queued || processing"
    :loading="processing && status?.running !== false"
    size="small"
    @click="retry"
  >
    {{ label }}
  </NButton>
  <NButton
    v-if="queued && !processing"
    size="small"
    text
    @click="emit('updated')"
  >
    刷新状态
  </NButton>
</template>
