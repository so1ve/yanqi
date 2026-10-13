<script setup lang="ts">
import { Refresh, Search } from "@vicons/tabler";
import { ref, watch } from "vue";

import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Message, Page } from "~/types/api";
import { api } from "~/utils/api";
import { formatTime } from "~/utils/format";

const { groupId, group } = useWorkspace();
const page = ref(1);
const query = ref("");
const searchQuery = ref("");
watch([groupId, searchQuery], () => {
  page.value = 1;
});
const { data, error, loading, refresh } = useApiData<Page<Message>>(() =>
  groupId.value
    ? `groups/${groupId.value}/messages?page=${page.value}&q=${encodeURIComponent(searchQuery.value)}`
    : "",
);
const { busy, run } = useAction();
async function retry(id: number): Promise<void> {
  await run(async () => {
    await api(`groups/${groupId.value}/assets/${id}/retry`, { method: "POST" });
    await refresh();
  }, "已安排重新解析");
}
const kinds: Record<string, string> = {
  image: "图片",
  audio: "语音",
  video: "视频",
  file: "文件",
  forward: "合并转发",
};
</script>

<template>
  <PageHeading
    :description="`${group?.name ?? '请先选择一个群'} · 最新消息在前，可查看附件和撤回标记`"
    title="原始消息"
  >
    <NButton :loading @click="refresh">
      <template #icon><NIcon :component="Refresh" /></template>
      刷新
    </NButton>
  </PageHeading>
  <ListToolbar as="form" @submit.prevent="searchQuery = query">
    <NInput
      v-model:value="query"
      class="search"
      clearable
      placeholder="搜索消息正文"
    >
      <template #prefix><NIcon :component="Search" /></template>
    </NInput>
    <NButton attr-type="submit">搜索</NButton>
    <span class="right muted">{{ data?.total ?? 0 }} 条消息</span>
  </ListToolbar>
  <LoadState
    description="搜索范围限于已保存的消息。小栖启动后才会接收已启用群的新消息。"
    :empty="!data?.items.length"
    :error
    :loading="loading && !data"
    :title="
      !groupId
        ? '请先选择一个群'
        : searchQuery
          ? '没有找到匹配的消息'
          : '还没有保存的消息'
    "
    @retry="refresh"
  >
    <div class="message-list">
      <article
        v-for="message in data?.items"
        :key="message.id"
        class="message-row"
      >
        <header class="message-meta">
          <strong>{{ message.displayName }}</strong>
          <span class="mono muted">{{ message.userId }}</span>
          <NTag v-if="message.isBot" :bordered="false" size="small">
            机器人
          </NTag>
          <NTag
            v-if="message.recalledAt"
            :bordered="false"
            size="small"
            type="warning"
          >
            已撤回
          </NTag>
          <time>{{ formatTime(message.sentAt) }} · m{{ message.id }}</time>
        </header>
        <p v-if="message.replyTo" class="cell-sub mb-9">
          回复 {{ message.replyTo }}
        </p>
        <p class="message-text">{{ message.text || "附件消息" }}</p>
        <section
          v-for="asset in message.assets"
          :key="asset.id"
          class="attachment"
        >
          <div class="attachment-header">
            <strong>
              {{ kinds[asset.kind] ?? asset.kind }} #{{ asset.id }}
            </strong>
            <NSpace>
              <a
                v-if="asset.downloadable"
                class="cell-sub"
                :href="`/api/groups/${groupId}/assets/${asset.id}`"
              >
                下载原件
              </a>
              <NButton
                v-if="asset.error || asset.state === 'failed'"
                :loading="busy"
                size="small"
                text
                @click="retry(asset.id)"
              >
                重新解析
              </NButton>
            </NSpace>
          </div>
          <p v-if="asset.error" class="error-text">{{ asset.error }}</p>
          <p>
            {{
              asset.interpretation ||
              (asset.state === "pending" ? "等待解析" : "没有解析结果")
            }}
          </p>
        </section>
      </article>
    </div>
    <ListPagination v-model:page="page" :total="data?.total ?? 0">
      时间均为北京时间 · 共 {{ data?.total }} 条
    </ListPagination>
  </LoadState>
</template>

<style scoped>
.muted {
  color: #798899;
}

.mono {
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.cell-sub {
  color: #8a97a7;
  font-size: 11px;
  margin-top: 4px;
}

.error-text {
  color: #bf655d;
}

.mb-9 {
  margin-bottom: 9px;
}

.message-list {
  background: #fff;
  border: 1px solid #e2e8ef;
  border-radius: 8px;
}

.message-row {
  padding: 20px 24px;
  border-bottom: 1px solid #edf0f4;
}

.message-row:last-child {
  border: 0;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 9px;
  font-size: 12px;
}

.message-meta time {
  margin-left: auto;
  color: #96a1af;
  font-size: 11px;
}

.message-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.85;
  font-size: 13px;
}

.attachment {
  margin-top: 12px;
  padding: 12px 16px;
  border: 1px solid #e4eaf0;
  border-left: 3px solid #b4cccc;
  border-radius: 5px;
  background: #f8fafb;
}

.attachment-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 7px;
}

.attachment p {
  font-size: 12px;
  color: #748496;
  white-space: pre-wrap;
}

@media (max-width: 760px) {
  .message-row {
    padding: 18px;
  }

  .message-meta {
    flex-wrap: wrap;
  }

  .message-meta time {
    margin-left: 0;
  }
}
</style>
