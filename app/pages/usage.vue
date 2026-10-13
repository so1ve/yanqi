<script setup lang="ts">
import { Refresh } from "@vicons/tabler";
import type { DataTableColumns } from "naive-ui";
import { computed, h } from "vue";

import { useApiData } from "~/composables/useApiData";
import { useQueryValue } from "~/composables/useQueryValue";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Usage } from "~/types/api";
import { formatNumber } from "~/utils/format";

const { groupId, group } = useWorkspace();
const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
}).format(Date.now());
const day = useQueryValue("day", (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return today;
  }
  const date = new Date(value);

  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : today;
});
const { data, loading, error, refresh } = useApiData<Usage>(() =>
  groupId.value ? `groups/${groupId.value}/usage?day=${day.value}` : "",
);
const totals = computed(() =>
  data.value?.models.reduce(
    (sum, item) => ({
      input: sum.input + item.input,
      output: sum.output + item.output,
      cache: sum.cache + item.cacheRead,
      measured: sum.measured + item.measuredCalls,
    }),
    { input: 0, output: 0, cache: 0, measured: 0 },
  ),
);
const purposes: Record<string, string> = {
  "decision:observe": "识别请求",
  "observe": "识别请求",
  "intent": "处理请求",
  "context_compaction": "压缩会话",
  "subagent": "资料助手",
  "subagent_history": "聊天查阅",
  "subagent_notes": "纪要分析",
  "detect": "识别讨论",
  "summary": "整理纪要",
  "summary_merge": "合并纪要",
  "publication": "判断是否发送",
  "image": "图片理解",
  "audio": "语音转写",
};
const columns: DataTableColumns<Usage["models"][number]> = [
  {
    title: "模型 / 服务",
    key: "model",
    minWidth: 220,
    render: (row) =>
      h("div", [
        h("strong", row.model),
        h(
          "div",
          { class: "cell-sub", style: "overflow-wrap: anywhere" },
          row.provider,
        ),
      ]),
  },
  {
    title: "用途",
    key: "purpose",
    minWidth: 110,
    render: (row) => purposes[row.purpose] ?? row.purpose,
  },
  {
    title: "调用次数",
    key: "calls",
    width: 80,
    render: (row) => formatNumber(row.calls),
  },
  {
    title: "输入",
    key: "input",
    width: 110,
    render: (row) => (row.measuredCalls ? formatNumber(row.input) : "未上报"),
  },
  {
    title: "输出",
    key: "output",
    width: 110,
    render: (row) => (row.measuredCalls ? formatNumber(row.output) : "未上报"),
  },
  {
    title: "缓存读 / 写",
    key: "cacheRead",
    width: 160,
    render: (row) =>
      row.measuredCalls
        ? `${formatNumber(row.cacheRead)} / ${formatNumber(row.cacheWrite)}`
        : "未上报",
  },
];
</script>

<template>
  <PageHeading
    :description="`${group?.name ?? '请先选择一个群'} · 统计模型服务返回的 token 用量，费用以服务商账单为准`"
    title="模型用量"
  >
    <NDatePicker
      v-model:formatted-value="day"
      class="filter-date"
      :clearable="false"
      type="date"
      value-format="yyyy-MM-dd"
    />
    <NButton :loading @click="refresh">
      <template #icon><NIcon :component="Refresh" /></template>
      刷新
    </NButton>
  </PageHeading>
  <LoadState :error :loading="loading && !data" @retry="refresh">
    <template v-if="data">
      <StatsGrid
        :items="[
          {
            label: '模型调用',
            value: formatNumber(data.calls),
            note: `${day} · 北京时间`,
          },
          {
            label: '输入 token',
            value: totals?.measured ? formatNumber(totals.input) : '-',
            note: '缓存读取另列',
          },
          {
            label: '输出 token',
            value: totals?.measured ? formatNumber(totals.output) : '-',
            note: '包含服务商上报的思考用量',
          },
          {
            label: '缓存读取',
            value: totals?.measured ? formatNumber(totals.cache) : '-',
            note: '命中缓存的输入 token',
          },
        ]"
      />
      <NAlert
        v-if="data.calls > (totals?.measured ?? 0)"
        :bordered="false"
        class="mb-22"
        type="info"
      >
        有 {{ data.calls - (totals?.measured ?? 0) }} 次调用没有返回 token
        用量，合计不含这些调用。费用请查看服务商账单。
      </NAlert>
      <AppPanel v-if="data.models.length > 0">
        <NDataTable
          :bordered="false"
          :columns
          :data="data.models"
          :scroll-x="800"
        />
      </AppPanel>
      <AppPanel v-else><EmptyState title="这一天还没有模型调用" /></AppPanel>
    </template>
  </LoadState>
</template>

<style scoped>
:deep(.cell-sub) {
  color: #8a97a7;
  font-size: 11px;
  margin-top: 4px;
}

.mb-22 {
  margin-bottom: 22px;
}

.filter-date {
  width: 160px;
}
</style>
