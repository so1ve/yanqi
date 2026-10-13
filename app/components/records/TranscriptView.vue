<script setup lang="ts">
import { Download } from "@vicons/tabler";
import type { Note } from "@yanqi/bot";
import { useMessage } from "naive-ui";
import { computed, onMounted, onScopeDispose, ref } from "vue";

import MessageList from "~/components/messages/MessageList.vue";
import type { Message, Page } from "~/types/api";
import { api, errorText } from "~/utils/api";

const props = defineProps<{ note: Note }>();
const pages = ref<Page<Message>[]>([]);
const loading = ref(false);
const error = ref("");
const notification = useMessage();
const controller = new AbortController();
const base = computed(
  () => `groups/${props.note.groupId}/records/${props.note.topicId}`,
);
const messages = computed(() => pages.value.flatMap((page) => page.items));
const total = computed(() => pages.value.at(-1)?.total ?? 0);
const finished = computed(
  () => pages.value.length > 0 && messages.value.length >= total.value,
);

const readPage = (page: number): Promise<Page<Message>> =>
  api(`${base.value}/messages`, {
    query: { version: props.note.id, page },
    signal: controller.signal,
    timeout: 15_000,
  });

async function loadMore(): Promise<void> {
  if (loading.value || error.value || finished.value) {
    return;
  }

  loading.value = true;

  try {
    pages.value.push(await readPage(pages.value.length + 1));
  } catch (cause) {
    if (!controller.signal.aborted) {
      error.value = errorText(cause);
    }
  } finally {
    loading.value = false;
  }
}

function retry(): void {
  error.value = "";
  void loadMore();
}

async function refreshMessage(messageId: number): Promise<void> {
  const index = pages.value.findIndex((page) =>
    page.items.some((message) => message.id === messageId),
  );

  try {
    pages.value[index] = await readPage(index + 1);
  } catch (cause) {
    if (!controller.signal.aborted) {
      notification.error(errorText(cause));
    }
  }
}

onMounted(loadMore);
onScopeDispose(() => controller.abort());
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
      :empty="messages.length === 0"
      :error="pages.length > 0 ? '' : error"
      :loading="loading && pages.length === 0"
      title="该版本暂无可展示的消息"
      @retry="retry"
    >
      <MessageList
        :messages
        virtual
        @load-more="loadMore"
        @updated="refreshMessage"
      />
      <footer aria-live="polite" class="transcript-status" role="status">
        <span>
          时间均为北京时间 · 已加载 {{ messages.length }} / {{ total }} 条
        </span>
        <span v-if="loading" class="loading-more">
          <NSpin :size="14" />
          正在加载更多消息
        </span>
        <span v-else-if="error" class="load-error">
          {{ error }}
          <NButton size="small" text @click="retry">重试</NButton>
        </span>
        <span v-else-if="finished">已显示全部消息</span>
        <span v-else>向下滚动加载更多</span>
      </footer>
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

.transcript-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  color: #6a7c88;
  font-size: 12px;
}

.loading-more,
.load-error {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.load-error {
  color: #ab554d;
}
</style>
