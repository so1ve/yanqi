<script setup lang="ts">
import { ref, watch } from "vue";

import ResourceGallery from "~/components/resources/ResourceGallery.vue";
import { useQueryValue } from "~/composables/useQueryValue";
import { useWorkspace } from "~/composables/useWorkspace";
import type { ResourceItem } from "~/types/api";
import { assetKindNames } from "~/utils/labels";

const { groupId, group, status } = useWorkspace();
const query = useQueryValue("q", (value) => value ?? "");
const kind = useQueryValue("kind", (value) =>
  value && Object.hasOwn(assetKindNames, value)
    ? (value as ResourceItem["kind"])
    : "",
);
const kinds = [
  { label: "全部资源", value: "" },
  ...Object.entries(assetKindNames).map(([value, label]) => ({ value, label })),
];
const draft = ref(query.value);
const version = ref(0);
watch(query, (value) => {
  draft.value = value;
});
</script>

<template>
  <PageHeading
    :description="`${group?.name || groupId} · 查看附件、识别结果与转发内容`"
    title="资源管理"
  >
    <NuxtLink to="/settings?tab=resources">存储与清理</NuxtLink>
    <NButton @click="version++">刷新</NButton>
    <template #toolbar>
      <ListToolbar as="form" @submit.prevent="query = draft.trim()">
        <NSelect v-model:value="kind" class="kind-filter" :options="kinds" />
        <NInput
          v-model:value="draft"
          class="search"
          clearable
          placeholder="搜索资源 ID（asset:139）、消息 ID（m983）或识别内容"
        />
        <NButton attr-type="submit">搜索</NButton>
      </ListToolbar>
    </template>
  </PageHeading>
  <NAlert
    v-if="status?.running === false"
    :bordered="false"
    class="paused"
    type="info"
  >
    AI 处理已暂停。可以查看已保存的资源，新提交的资源任务会在恢复后继续。
  </NAlert>
  <ResourceGallery
    :key="`${groupId}:${kind}:${query}:${version}`"
    :group-id
    :kind
    :query
  />
</template>

<style scoped>
.kind-filter {
  width: 150px;
}
.paused {
  margin-bottom: 16px;
}
</style>
