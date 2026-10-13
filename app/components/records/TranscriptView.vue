<script setup lang="ts">
import { Download, Refresh } from "@vicons/tabler";
import type { Note } from "@yanqi/bot";
import { computed, useTemplateRef } from "vue";

import MessageHistory from "~/components/messages/MessageHistory.vue";

const props = defineProps<{ note: Note }>();
const history = useTemplateRef<InstanceType<typeof MessageHistory>>("history");
const base = computed(
  () => `groups/${props.note.groupId}/records/${props.note.topicId}`,
);
</script>

<template>
  <div class="transcript">
    <header class="transcript-toolbar">
      <span>第 {{ note.revision }} 版原文 · 按时间顺序排列</span>
      <div class="transcript-actions">
        <NButton
          aria-label="刷新原文"
          :loading="history?.loading"
          size="small"
          text
          @click="history?.refresh()"
        >
          <template #icon><NIcon :component="Refresh" /></template>
        </NButton>
        <a
          class="download-link"
          download="原始对话.md"
          :href="`/api/${base}/transcript?version=${note.id}`"
        >
          <NIcon :component="Download" :size="16" />
          下载原文
        </a>
      </div>
    </header>
    <MessageHistory
      :key="note.id"
      ref="history"
      empty-title="该版本暂无可展示的消息"
      :group-id="note.groupId"
      :source="`${base}/messages?version=${note.id}`"
    />
  </div>
</template>

<style scoped>
.transcript {
  max-width: 1080px;
  margin: 0 auto;
}

.transcript-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  color: #6a7c88;
  font-size: 12px;
}

.transcript-actions,
.download-link {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
</style>
