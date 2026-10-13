<script setup lang="ts">
import { Download, PlayerPause, PlayerPlay, Refresh } from "@vicons/tabler";
import { computed } from "vue";

import { useApiData } from "~/composables/useApiData";
import { usePoll } from "~/composables/usePoll";
import { useQueryValue } from "~/composables/useQueryValue";
import type { LogEntry } from "~/types/api";
import { downloadText } from "~/utils/download";
import { formatTime } from "~/utils/format";

const { data, loading, error, refresh } = useApiData<LogEntry[]>("logs");
const query = useQueryValue("q", (value) => value ?? "", { replace: true });
const level = useQueryValue("level", (value) =>
  value && ["debug", "error", "info", "warn"].includes(value) ? value : "",
);
const paused = useQueryValue("paused", (value) => (value === "1" ? "1" : ""));
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
    <template #toolbar>
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
        <NButton class="right" @click="paused = paused ? '' : '1'">
          <template #icon>
            <NIcon :component="paused ? PlayerPlay : PlayerPause" />
          </template>
          {{ paused ? "恢复刷新" : "暂停刷新" }}
        </NButton>
      </ListToolbar>
    </template>
  </PageHeading>
  <LoadState :error :loading="loading && !data" @retry="refresh">
    <div aria-label="运行日志" class="log-window">
      <div
        v-for="entry in filtered"
        :key="entry.id"
        class="log-row"
        :class="entry.level"
      >
        <time>{{ formatTime(entry.time) }}</time>
        <span class="level">{{ entry.level.toUpperCase() }}</span>
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
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 6px 0;
  max-height: calc(100vh - 270px);
  min-height: 380px;
  overflow: auto;
  color-scheme: dark;
  color: #d1d9e0;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  line-height: 18px;
}

.log-row {
  display: grid;
  grid-template-columns: 110px 52px 120px minmax(0, 1fr);
  column-gap: 10px;
  padding: 2px 12px;
  border-left: 2px solid transparent;
  border-bottom: 1px solid #21262d;
  align-items: start;
}

.log-row:nth-child(even) {
  background: #151b23;
}

.log-row:hover {
  background: #212b38;
}

.log-row time {
  color: #8b949e;
  font-size: 11px;
  white-space: nowrap;
}

.log-row .level {
  font-weight: 600;
}

.log-row.info .level {
  color: #79c0ff;
}

.log-row.debug .level {
  color: #c4a7e7;
}

.log-row.warn {
  border-left-color: #e3b341;
}

.log-row.warn .level {
  color: #e3b341;
}

.log-row.error {
  border-left-color: #ff7b72;
}

.log-row.error .level {
  color: #ff7b72;
}

.log-row .source {
  color: #7ed9c6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-row .content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.log-window ::selection {
  background: #365b82;
  color: #fff;
}

@media (max-width: 760px) {
  .log-row {
    grid-template-columns: 90px 44px minmax(0, 1fr);
    padding: 4px 10px;
  }

  .log-row .content {
    grid-column: 1 / -1;
  }
}

.log-window :deep(.empty-state h3) {
  color: #d1d9e0;
}
</style>
