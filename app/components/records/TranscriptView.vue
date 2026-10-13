<script setup lang="ts">
import { Download } from "@vicons/tabler";
import type { Note } from "@yanqi/bot";
import { computed, ref, watch } from "vue";

import MessageList from "~/components/messages/MessageList.vue";
import { useApiData } from "~/composables/useApiData";
import type { Message, Page } from "~/types/api";

const props = defineProps<{ note: Note }>();
const page = ref(1);
const base = computed(
  () => `groups/${props.note.groupId}/records/${props.note.topicId}`,
);

watch(
  () => props.note.id,
  () => {
    page.value = 1;
  },
);

const { data, error, loading, refresh } = useApiData<Page<Message>>(
  () => `${base.value}/messages?version=${props.note.id}&page=${page.value}`,
);
</script>

<template>
  <div class="transcript">
    <header class="transcript-toolbar">
      <span>第 {{ note.revision }} 版原文 · 按时间顺序排列</span>
      <a
        class="download-link"
        download="原始对话.md"
        :href="`/api/${base}/transcript?version=${note.id}`"
      >
        <NIcon :component="Download" :size="16" />
        下载原文
      </a>
    </header>
    <LoadState
      description="可以下载当时保存的原文。"
      :empty="!data?.items.length"
      :error
      :loading
      title="该版本暂无可展示的消息"
      @retry="refresh"
    >
      <MessageList :messages="data?.items ?? []" @updated="refresh" />
      <ListPagination v-model:page="page" :total="data?.total ?? 0">
        时间均为北京时间 · 共 {{ data?.total }} 条
      </ListPagination>
    </LoadState>
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

.download-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
