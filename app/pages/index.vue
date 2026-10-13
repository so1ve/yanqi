<script setup lang="ts">
import { ArrowRight, Refresh } from "@vicons/tabler";

import { navigateTo } from "#imports";
import { useApiData } from "~/composables/useApiData";
import { usePoll } from "~/composables/usePoll";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Overview } from "~/types/api";
import { formatNumber, formatTime } from "~/utils/format";
import { kindNames } from "~/utils/labels";

const { data, loading, error, refresh } = useApiData<Overview>("overview");
const { groupId, groups, status } = useWorkspace();
usePoll(refresh, 10_000);
async function openRecord(group: string, id: string): Promise<void> {
  groupId.value = group;
  await navigateTo(`/records/${id}?group=${group}`);
}
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
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">已保存消息</div>
          <div class="stat-value">{{ formatNumber(data.messages) }}</div>
          <div class="stat-note">所有群的成员消息总数</div>
        </div>
        <div class="stat">
          <div class="stat-label">纪要</div>
          <div class="stat-value">{{ formatNumber(data.records) }}</div>
          <div class="stat-note">同一篇的多个版本计为一篇</div>
        </div>
        <div class="stat">
          <div class="stat-label">排队 / 处理中</div>
          <div class="stat-value">{{ formatNumber(data.pending) }}</div>
          <div class="stat-note">
            {{ data.failed ? `${data.failed} 个任务失败` : "没有失败任务" }}
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">已启用的群</div>
          <div class="stat-value">
            {{ formatNumber(status?.groups.length) }}
          </div>
          <div class="stat-note">
            {{
              status?.running
                ? "机器人已启动"
                : "AI 已暂停，NapCat 在线时仍保存群消息"
            }}
          </div>
        </div>
      </div>
      <div class="overview-columns">
        <section class="panel">
          <div class="panel-header">
            <h2>最近的记录</h2>
            <NuxtLink to="/records">
              查看纪要
              <NIcon :component="ArrowRight" />
            </NuxtLink>
          </div>
          <div v-if="data.recent.length > 0">
            <a
              v-for="record in data.recent"
              :key="record.id"
              class="record-link"
              href="#"
              @click.prevent="openRecord(record.groupId, record.id)"
            >
              <span class="cell-sub">
                {{
                  groups.find((item) => item.id === record.groupId)?.name ??
                  record.groupId
                }}
              </span>
              <h3>{{ record.title }}</h3>
              <p>
                <StateTag :state="record.state" />
                <span>
                  {{
                    record.revision
                      ? `第 ${record.revision} 版`
                      : "尚未生成纪要"
                  }}
                </span>
                <time>{{ formatTime(record.lastActiveAt) }}</time>
              </p>
            </a>
          </div>
          <div v-else class="empty-state">
            <h3>还没有纪要</h3>
            <p>
              连接 NapCat
              并启用群记录后，可以在群里让小栖整理讨论，也可以在“纪要”页新建。
            </p>
            <NuxtLink to="/settings"><NButton>连接 NapCat</NButton></NuxtLink>
          </div>
        </section>
        <div>
          <section class="panel">
            <div class="panel-header">
              <h2>排队和处理中的任务</h2>
              <NuxtLink to="/tasks">全部</NuxtLink>
            </div>
            <div v-for="task in data.tasks" :key="task.id" class="task-brief">
              <span class="task-number">#{{ task.id }}</span>
              <div>
                <h3>{{ kindNames[task.kind] ?? task.kind }}</h3>
                <p>
                  {{ task.progress || `群 ${task.payload.groupId}` }}
                </p>
                <StateTag :state="task.state" />
              </div>
            </div>
            <div v-if="data.tasks.length === 0" class="empty-state">
              <h3>没有待处理任务</h3>
            </div>
          </section>
          <section class="panel daily-usage">
            <div class="panel-body">
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
                :percentage="
                  Math.min(100, (data.calls / data.dailyLimit) * 100)
                "
                :show-indicator="false"
                type="line"
              />
              <NuxtLink class="cell-sub usage-link" to="/usage">
                按模型查看 token 用量 →
              </NuxtLink>
            </div>
          </section>
        </div>
      </div>
    </template>
  </LoadState>
</template>
