<script setup lang="ts">
import { Download, PlayerPause, PlayerPlay, Refresh } from "@vicons/tabler";
import { computed, ref } from "vue";

import { useApiData } from "~/composables/useApiData";
import { usePoll } from "~/composables/usePoll";
import type { LogEntry } from "~/types/api";
import { formatTime } from "~/utils/api";

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
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `yanqi-${new Date().toISOString().slice(0, 10)}.log`;
  anchor.click();
  URL.revokeObjectURL(url);
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
  <div class="toolbar">
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
  </div>
  <LoadState :error :loading="loading && !data" @retry="refresh">
    <div aria-label="运行日志" class="log-window">
      <div v-for="entry in filtered" :key="entry.id" class="log-row">
        <time>{{ formatTime(entry.time) }}</time>
        <span :class="entry.level">{{ entry.level.toUpperCase() }}</span>
        <span class="source" :title="entry.name">{{ entry.name }}</span>
        <span class="content">{{ entry.text }}</span>
      </div>
      <div v-if="filtered.length === 0" class="empty-state">
        <h3 class="log-empty-title">没有符合条件的日志</h3>
      </div>
    </div>
    <p class="form-help">
      服务重启后，此列表会清空。更早的日志请用
      <code>docker compose logs yanqi</code>
      查看。
    </p>
  </LoadState>
</template>
