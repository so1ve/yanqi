<script setup lang="ts">
import { Download, PlayerPause, PlayerPlay, Refresh } from "@vicons/tabler";
import { computed, ref } from "vue";

import { useApiData } from "~/composables/useApiData";
import { usePoll } from "~/composables/usePoll";
import type { LogEntry } from "~/types/api";
import { downloadText } from "~/utils/download";
import { formatTime } from "~/utils/format";

const { data, loading, error, refresh } = useApiData<LogEntry[]>("logs");
const query = ref("");
const level = ref("");
const paused = ref(false);
const filtered = computed(() =>
  (data.value ?? [])
    .filter(
      (entry) =>
        (!level.value || entry.level === level.value) &&
        `${entry.name} ${entry.text}`.includes(query.value),
    )
    .toReversed(),
);
usePoll(async () => {
  if (!paused.value) {
    await refresh();
  }
});
function download(): void {
  const text = filtered.value
    .toReversed()
    .map(
      (entry) =>
        `${new Date(entry.time).toISOString()} [${entry.level}] ${entry.name} ${entry.text}`,
    )
    .join("\n");
  downloadText(`yanqi-${new Date().toISOString().slice(0, 10)}.log`, text);
}
</script>

<template>
  <PageHeading
    description="显示所有群最近 1,000 条日志。最新日志在前。"
    title="运行日志"
  >
    <NButton @click="download">
      <template #icon><NIcon :component="Download" /></template>
      导出筛选结果
    </NButton>
    <NButton :loading @click="refresh">
      <template #icon><NIcon :component="Refresh" /></template>
      刷新
    </NButton>
  </PageHeading>
  <ListToolbar>
    <NInput
      v-model:value="query"
      class="search"
      clearable
      placeholder="按群号、任务编号或内容筛选"
    />
    <NSelect
      v-model:value="level"
      class="filter-level"
      :options="[
        { label: '全部级别', value: '' },
        { label: '信息 · Info', value: 'info' },
        { label: '警告 · Warn', value: 'warn' },
        { label: '错误 · Error', value: 'error' },
        { label: '调试 · Debug', value: 'debug' },
      ]"
    />
    <NButton class="right" @click="paused = !paused">
      <template #icon>
        <NIcon :component="paused ? PlayerPlay : PlayerPause" />
      </template>
      {{ paused ? "恢复刷新" : "暂停刷新" }}
    </NButton>
  </ListToolbar>
  <LoadState :error :loading="loading && !data" @retry="refresh">
    <div aria-label="运行日志" class="log-window">
      <div v-for="entry in filtered" :key="entry.id" class="log-row">
        <time>{{ formatTime(entry.time) }}</time>
        <span :class="entry.level">{{ entry.level.toUpperCase() }}</span>
        <span class="source" :title="entry.name">{{ entry.name }}</span>
        <span class="content">{{ entry.text }}</span>
      </div>
      <EmptyState v-if="filtered.length === 0" title="没有符合条件的日志" />
    </div>
    <p class="form-help">
      服务重启后，此列表会清空。更早的日志请用
      <code>docker compose logs yanqi</code>
      查看。
    </p>
  </LoadState>
</template>

<style scoped>
.form-help {
  font-size: 12px;
  color: #8a97a7;
  margin-top: 7px;
}

.filter-level {
  width: 135px;
}

.log-window {
  background: #202c3a;
  border-radius: 8px;
  padding: 16px 0;
  max-height: calc(100vh - 270px);
  min-height: 380px;
  overflow: auto;
  color: #bbc9d7;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
}

.log-row {
  display: grid;
  grid-template-columns: 110px 52px 120px minmax(0, 1fr);
  gap: 12px;
  padding: 7px 20px;
  align-items: baseline;
}

.log-row:hover {
  background: #273546;
}

.log-row time {
  color: #698196;
  font-size: 11px;
}

.log-row .source {
  color: #8dc5c3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-row .content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.log-row .warn,
.log-row .error {
  color: #e9b26c;
}

@media (max-width: 760px) {
  .log-row {
    grid-template-columns: 60px 40px 1fr;
    padding: 9px 12px;
    gap: 8px;
  }

  .log-row .content {
    grid-column: 1 / -1;
  }
}

.log-window :deep(.empty-state h3) {
  color: #bbc9d7;
}
</style>
