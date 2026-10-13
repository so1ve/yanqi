<script setup lang="ts">
import { History, X } from "@vicons/tabler";
import { useTemplateRef } from "vue";

import MessageList from "~/components/messages/MessageList.vue";
import { useMessageHistory } from "~/composables/useMessageHistory";
import { formatTime } from "~/utils/format";

const props = defineProps<{
  groupId: string;
  source: string;
  emptyTitle: string;
  fromLatest?: boolean;
}>();
const list = useTemplateRef<InstanceType<typeof MessageList>>("list");
const {
  messages,
  total,
  loading,
  error,
  cacheError,
  bookmark,
  finished,
  loadMore,
  refresh,
  refreshMessage,
  remember,
  reveal,
} = useMessageHistory(props.groupId, props.source, props.fromLatest);

async function resume(): Promise<void> {
  const target = bookmark.value;

  if (!target) {
    return;
  }

  if (!(await reveal(target.messageId))) {
    return;
  }

  await list.value?.restore(target);
  remember(target);
  bookmark.value = undefined;
}

defineExpose({ loading, refresh });
</script>

<template>
  <LoadState
    :empty="messages.length === 0"
    :error="messages.length > 0 ? '' : error"
    :loading="loading && messages.length === 0"
    :title="emptyTitle"
    @retry="refresh(false)"
  >
    <MessageList
      ref="list"
      :from-latest
      :loading
      :messages
      @load-more="loadMore"
      @position="remember"
      @updated="refreshMessage"
    />
    <footer aria-live="polite" class="history-status" role="status">
      <span>北京时间 · 已加载 {{ messages.length }} / {{ total }} 条</span>
      <span v-if="loading" class="status-detail">
        <NSpin :size="14" />
        正在加载
      </span>
      <span v-else-if="error" class="status-detail load-error">
        {{ error }}
        <NButton size="small" text @click="refresh(false)">重试</NButton>
      </span>
      <span v-else-if="finished">已加载全部消息</span>
      <span v-else>
        {{ fromLatest ? "向上滚动查看更早的消息" : "向下滚动加载更多" }}
      </span>
    </footer>
    <p v-if="cacheError" class="load-error">{{ cacheError }}</p>
    <div v-if="bookmark" class="resume-reading">
      <button
        class="resume-button"
        :disabled="loading"
        type="button"
        @click="resume"
      >
        <NIcon :component="History" :size="22" />
        <span class="resume-content">
          <strong>回到上次阅读</strong>
          <span>
            {{ formatTime(bookmark.sentAt) }} · {{ bookmark.preview }}
          </span>
        </span>
      </button>
      <button
        aria-label="关闭阅读位置提示"
        class="dismiss-button"
        type="button"
        @click="bookmark = undefined"
      >
        <NIcon :component="X" :size="16" />
      </button>
    </div>
  </LoadState>
</template>

<style scoped>
.history-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  color: #6a7c88;
  font-size: 12px;
}

.status-detail {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.load-error {
  color: #ab554d;
  font-size: 12px;
}

.resume-reading {
  position: fixed;
  right: 28px;
  bottom: 24px;
  z-index: 20;
  display: flex;
  width: min(340px, calc(100vw - 32px));
  overflow: hidden;
  border: 1px solid #d1e2e2;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 8px 32px #183d4426;
}

.resume-button,
.dismiss-button {
  display: flex;
  align-items: center;
  border: 0;
  background: transparent;
  color: #237f82;
  cursor: pointer;
  font: inherit;
}

.resume-button {
  min-width: 0;
  flex: 1;
  gap: 12px;
  padding: 14px 8px 14px 18px;
  text-align: left;
}

.resume-content {
  display: grid;
  min-width: 0;
  gap: 4px;
  font-size: 13px;
}

.resume-content > span {
  overflow: hidden;
  color: #70858c;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dismiss-button {
  align-self: flex-start;
  padding: 10px;
  color: #819397;
}

.resume-button:hover,
.dismiss-button:hover {
  background: #f0f8f7;
}

.resume-button:focus-visible,
.dismiss-button:focus-visible {
  outline: 2px solid #237f82;
  outline-offset: -3px;
}

@media (max-width: 760px) {
  .resume-reading {
    right: 16px;
    bottom: 16px;
  }
}
</style>
