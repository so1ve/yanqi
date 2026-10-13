<script setup lang="ts">
import { Refresh, Search } from "@vicons/tabler";
import { ref, watch } from "vue";

import MessageList from "~/components/messages/MessageList.vue";
import { useApiData } from "~/composables/useApiData";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Message, Page } from "~/types/api";

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
</script>

<template>
  <PageHeading
    :description="`${group?.name ?? '请先选择一个群'} · 查看完整发言、引用和附件`"
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
    description="搜索范围限于已保存的消息。言栖服务在线时，会保存已启用群的新消息。"
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
    <p class="reading-order">第 1 页是最近的消息，每页从早到晚排列。</p>
    <MessageList :messages="data?.items ?? []" @updated="refresh" />
    <ListPagination v-model:page="page" :total="data?.total ?? 0">
      时间均为北京时间 · 共 {{ data?.total }} 条
    </ListPagination>
  </LoadState>
</template>

<style scoped>
.muted {
  color: #798899;
}

.reading-order {
  margin-bottom: 12px;
  color: #6a7c88;
  font-size: 12px;
}
</style>
