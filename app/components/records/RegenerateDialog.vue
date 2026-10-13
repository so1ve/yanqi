<script setup lang="ts">
import type { Topic } from "@yanqi/bot";
import { ref } from "vue";

import { useAction } from "~/composables/useAction";
import { api } from "~/utils/api";

const emit = defineEmits<{ close: []; saved: [] }>();
const props = defineProps<{ topic: Topic }>();
const topic = props.topic;
const focus = ref(topic.focus);
const { busy, run } = useAction();

async function regenerate(): Promise<void> {
  if (
    await run(
      () =>
        api(`groups/${topic.groupId}/records/${topic.id}/summarize`, {
          method: "POST",
          body: { focus: focus.value },
        }),
      "已安排重新整理",
    )
  ) {
    emit("saved");
    emit("close");
  }
}
</script>

<template>
  <AppDialog title="重新整理这篇纪要" @close="emit('close')">
    <p class="muted mb-20">
      按下方要求重新整理原文，保存为新版本。完成后不会自动发到群里。
    </p>
    <NInput
      v-model:value="focus"
      :autosize="{ minRows: 5, maxRows: 12 }"
      placeholder="整理要求"
      type="textarea"
    />
    <NSpace class="mt-24" justify="end">
      <NButton :disabled="busy" @click="emit('close')">取消</NButton>
      <NButton :loading="busy" type="primary" @click="regenerate">
        开始整理
      </NButton>
    </NSpace>
  </AppDialog>
</template>

<style scoped>
.muted {
  color: #798899;
}

.mb-20 {
  margin-bottom: 20px;
}

.mt-24 {
  margin-top: 24px;
}
</style>
