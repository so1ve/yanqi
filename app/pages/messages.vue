<script setup lang="ts">
import { Refresh, Search } from "@vicons/tabler";
import { computed, ref, useTemplateRef } from "vue";

import MessageHistory from "~/components/messages/MessageHistory.vue";
import { useWorkspace } from "~/composables/useWorkspace";

const { groupId, group } = useWorkspace();
const history = useTemplateRef<InstanceType<typeof MessageHistory>>("history");
const query = ref("");
const searchQuery = ref("");
const source = computed(
  () =>
    `groups/${groupId.value}/messages?q=${encodeURIComponent(searchQuery.value)}`,
);
</script>

<template>
  <PageHeading
    :description="`${group?.name ?? '请先选择一个群'} · 查看完整发言、引用和附件`"
    title="原始消息"
  >
    <NButton :loading="history?.loading" @click="history?.refresh()">
      <template #icon><NIcon :component="Refresh" /></template>
      刷新
    </NButton>
    <template #toolbar>
      <ListToolbar as="form" @submit.prevent="searchQuery = query.trim()">
        <NInput
          v-model:value="query"
          class="search"
          clearable
          placeholder="搜索消息正文"
        >
          <template #prefix><NIcon :component="Search" /></template>
        </NInput>
        <NButton attr-type="submit">搜索</NButton>
        <span class="right reading-order">按时间顺序排列 · 向下滚动加载</span>
      </ListToolbar>
    </template>
  </PageHeading>
  <MessageHistory
    v-if="groupId"
    :key="source"
    ref="history"
    :empty-title="searchQuery ? '没有找到匹配的消息' : '还没有保存的消息'"
    :group-id
    :source
  />
  <NEmpty v-else description="请先选择一个群" />
</template>

<style scoped>
.reading-order {
  color: #6a7c88;
  font-size: 12px;
}
</style>
