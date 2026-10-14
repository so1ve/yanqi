<script setup lang="ts">
import { ref, watch } from "vue";

import ImageGallery from "~/components/images/ImageGallery.vue";
import { useQueryValue } from "~/composables/useQueryValue";
import { useWorkspace } from "~/composables/useWorkspace";

const { groupId, group } = useWorkspace();
const query = useQueryValue("q", (value) => value ?? "");
const draft = ref(query.value);
const version = ref(0);
watch(query, (value) => {
  draft.value = value;
});
</script>

<template>
  <PageHeading
    :description="`${group?.name || groupId} · 浏览原图与识图结果`"
    title="图片"
  >
    <NuxtLink to="/settings?tab=resources">清理图片与识图缓存</NuxtLink>
    <NButton @click="version++">刷新</NButton>
    <template #toolbar>
      <ListToolbar as="form" @submit.prevent="query = draft.trim()">
        <NInput
          v-model:value="draft"
          class="search"
          clearable
          placeholder="搜索图片 ID（如 asset:139）或识图描述"
        />
        <NButton attr-type="submit">搜索</NButton>
      </ListToolbar>
    </template>
  </PageHeading>
  <ImageGallery :key="`${groupId}:${query}:${version}`" :group-id :query />
</template>
