<script setup lang="ts">
import { ArrowRight, Refresh } from "@vicons/tabler";

import RecordStatus from "~/components/records/RecordStatus.vue";
import { useApiData } from "~/composables/useApiData";
import { usePoll } from "~/composables/usePoll";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Overview } from "~/types/api";
import { formatNumber, formatTime } from "~/utils/format";
import { kindNames } from "~/utils/labels";

const { data, loading, error, refresh } = useApiData<Overview>("overview");
const { groups, status } = useWorkspace();
usePoll(refresh, 10_000);
</script>

<template>
  <PageHeading description="查看所有群的消息、纪要和任务进度。" title="概览">
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
            label: '已保存消息',
            value: formatNumber(data.messages),
            note: '所有群的成员消息总数',
          },
          {
            label: '纪要',
            value: formatNumber(data.records),
            note: '同一篇的多个版本计为一篇',
          },
          {
            label: '排队 / 处理中',
            value: formatNumber(data.pending),
            note: data.failed ? `${data.failed} 个任务失败` : '没有失败任务',
          },
          {
            label: '已启用的群',
            value: formatNumber(status?.groups.length),
            note: status?.running
              ? '机器人已启动'
              : 'AI 已暂停，NapCat 在线时仍保存群消息',
          },
        ]"
      />
      <div class="overview-columns">
        <AppPanel>
          <template #header>
            <h2>最近的记录</h2>
            <NuxtLink to="/groups">
              查看全部群聊
              <NIcon :component="ArrowRight" />
            </NuxtLink>
          </template>
          <div v-if="data.recent.length > 0">
            <NuxtLink
              v-for="record in data.recent"
              :key="record.id"
              class="record-link"
              :to="`/${record.groupId}/records/${record.id}`"
            >
              <span class="cell-sub">
                {{
                  groups.find((item) => item.id === record.groupId)?.name ??
                  record.groupId
                }}
              </span>
              <h3>{{ record.title }}</h3>
              <p>
                <RecordStatus :topic="record" />
                <span>
                  {{
                    record.revision
                      ? `第 ${record.revision} 版`
                      : "尚未生成纪要"
                  }}
                </span>
                <time>{{ formatTime(record.lastActiveAt) }}</time>
              </p>
            </NuxtLink>
          </div>
          <EmptyState
            v-else
            description="连接 NapCat 并启用群记录后，可以在群里让小栖整理讨论，也可以在“纪要”页新建。"
            title="还没有纪要"
          >
            <NuxtLink to="/settings">
              <NButton>连接 NapCat</NButton>
            </NuxtLink>
          </EmptyState>
        </AppPanel>
        <div>
          <AppPanel>
            <template #header>
              <h2>排队和处理中的任务</h2>
              <NuxtLink to="/groups">按群查看</NuxtLink>
            </template>
            <div v-for="task in data.tasks" :key="task.id" class="task-brief">
              <span class="task-number">#{{ task.id }}</span>
              <div>
                <h3>
                  <NuxtLink :to="`/${task.payload.groupId}/tasks`">
                    {{ kindNames[task.kind] ?? task.kind }}
                  </NuxtLink>
                </h3>
                <p>
                  {{ task.progress || `群 ${task.payload.groupId}` }}
                </p>
                <StateTag :state="task.state" />
              </div>
            </div>
            <EmptyState v-if="data.tasks.length === 0" title="没有待处理任务" />
          </AppPanel>
          <AppPanel class="daily-usage" padded>
            <h3>今日模型调用 / 上限</h3>
            <p>
              <span>{{ data.day }} · 北京时间</span>
              <span>
                {{ formatNumber(data.calls) }} /
                {{ formatNumber(data.dailyLimit) }}
              </span>
            </p>
            <NProgress
              :height="5"
              :percentage="Math.min(100, (data.calls / data.dailyLimit) * 100)"
              :show-indicator="false"
              type="line"
            />
            <NuxtLink class="cell-sub usage-link" to="/groups">
              按群查看 token 用量 →
            </NuxtLink>
          </AppPanel>
        </div>
      </div>
    </template>
  </LoadState>
</template>

<style scoped>
.cell-sub {
  color: #8a97a7;
  font-size: 11px;
  margin-top: 4px;
}

.overview-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr);
  gap: 24px;
  align-items: start;
}

.record-link {
  display: block;
  padding: 20px 24px;
  border-bottom: 1px solid #edf0f4;
  color: #243348;
}

.record-link:last-child {
  border: 0;
}

.record-link:hover {
  background: #f9fbfc;
}

.record-link h3 {
  font-size: 14px;
  margin: 3px 0 8px;
}

.record-link p {
  color: #8592a2;
  font-size: 12px;
  display: flex;
  gap: 14px;
  align-items: center;
}

.task-brief {
  display: flex;
  gap: 12px;
  padding: 18px 22px;
  border-bottom: 1px solid #edf0f4;
  align-items: flex-start;
}

.task-brief:last-child {
  border: 0;
}

.task-brief p {
  font-size: 12px;
  color: #8a97a7;
  margin-top: 6px;
  overflow-wrap: anywhere;
}

.task-number {
  color: #a3afbd;
  font-size: 11px;
  margin-top: 3px;
}

.daily-usage {
  margin-top: 24px;
}

.daily-usage p {
  display: flex;
  justify-content: space-between;
  gap: 15px;
  font-size: 12px;
  color: #798899;
  margin: 8px 0 16px;
}

@media (max-width: 1100px) {
  .overview-columns {
    grid-template-columns: 1fr;
  }
}

.usage-link {
  display: block;
  margin-top: 15px;
}
</style>
