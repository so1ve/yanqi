<script setup lang="ts">
import { Refresh, Search } from "@vicons/tabler";
import { computed, ref, useTemplateRef, watch } from "vue";

import MessageHistory from "~/components/messages/MessageHistory.vue";
import { useQueryValue } from "~/composables/useQueryValue";
import { useWorkspace } from "~/composables/useWorkspace";

const { groupId, group } = useWorkspace();
const history = useTemplateRef<InstanceType<typeof MessageHistory>>("history");
const searchQuery = useQueryValue("q", (value) => value ?? "");
const query = ref(searchQuery.value);
watch(searchQuery, (value) => {
  query.value = value;
});
const source = computed(
  () =>
    `groups/${groupId.value}/messages?q=${encodeURIComponent(searchQuery.value)}`,
);
</script>

<template>
  <PageHeading
    :description="`${group?.name ?? groupId} · 查看完整发言、引用和附件`"
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
          placeholder="搜索正文或消息 ID（如 m983）"
        >
          <template #prefix><NIcon :component="Search" /></template>
        </NInput>
        <NButton attr-type="submit">搜索</NButton>
        <span class="right reading-order">最新消息在底部 · 向上查看历史</span>
      </ListToolbar>
    </template>
  </PageHeading>
  <MessageHistory
    :key="source"
    ref="history"
    :empty-title="searchQuery ? '没有找到匹配的消息' : '还没有保存的消息'"
    from-latest
    :group-id
    :source
  />
</template>

<style scoped>
.reading-order {
  color: #6a7c88;
  font-size: 12px;
}
</style>
