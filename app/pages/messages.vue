<script setup lang="ts">
import { Refresh, Search } from "@vicons/tabler";
import { ref, watch } from "vue";

import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Message, Page } from "~/types/api";
import { api, formatTime } from "~/utils/api";

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
  <form class="toolbar" @submit.prevent="searchQuery = query">
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
  </form>
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
    <div class="pagination">
      <span>时间均为北京时间 · 共 {{ data?.total }} 条</span>
      <NPagination
        v-model:page="page"
        :item-count="data?.total ?? 0"
        :page-size="30"
      />
    </div>
  </LoadState>
</template>
