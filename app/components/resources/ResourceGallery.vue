<script setup lang="ts">
import { NVirtualList, useMessage } from "naive-ui";
import { nextTick, onMounted, onScopeDispose, ref, useTemplateRef } from "vue";

import ResourceCard from "~/components/resources/ResourceCard.vue";
import type { ResourceItem, ResourcePage } from "~/types/api";
import { api, errorText } from "~/utils/api";

const props = defineProps<{
  groupId: string;
  query: string;
  kind: ResourceItem["kind"] | "";
}>();
const message = useMessage();
const items = ref<ResourceItem[]>([]);
const loading = ref(false);
const error = ref("");
const next = ref<number | null>(null);
const list = useTemplateRef<InstanceType<typeof NVirtualList>>("list");
const controller = new AbortController();
onScopeDispose(() => controller.abort());

async function load() {
  if (loading.value) {
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const page = await api<ResourcePage>(`groups/${props.groupId}/resources`, {
      query: {
        q: props.query || undefined,
        kind: props.kind || undefined,
        before: next.value ?? undefined,
      },
      signal: controller.signal,
    });
    items.value.push(...page.items);
    next.value = page.next;
  } catch (cause) {
    if (!controller.signal.aborted) {
      error.value = errorText(cause);
    }
  } finally {
    loading.value = false;
  }
  await nextTick();
  if (!error.value && !controller.signal.aborted) {
    onScroll();
  }
}
function onScroll() {
  const scroller = list.value?.getScrollContainer();
  if (
    next.value !== null &&
    !error.value &&
    scroller &&
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 400
  ) {
    void load();
  }
}
async function update(id: number) {
  try {
    const page = await api<ResourcePage>(`groups/${props.groupId}/resources`, {
      query: { q: `asset:${id}` },
      signal: controller.signal,
    });
    const index = items.value.findIndex((item) => item.id === id);
    if (index !== -1 && page.items[0]) {
      if (props.kind && page.items[0].kind !== props.kind) {
        items.value.splice(index, 1);
      } else {
        items.value[index] = page.items[0];
      }
    }
  } catch (cause) {
    if (!controller.signal.aborted) {
      message.error(errorText(cause));
    }
  }
}
onMounted(load);
</script>

<template>
  <LoadState
    :empty="!loading && !error && items.length === 0"
    :error="items.length > 0 ? '' : error"
    :loading="loading && items.length === 0"
    title="没有符合条件的资源"
    @retry="load"
  >
    <NVirtualList
      ref="list"
      class="resource-list"
      item-resizable
      :item-size="300"
      :items
      key-field="id"
      @scroll="onScroll"
    >
      <template #default="{ item }">
        <ResourceCard :asset="item" :group-id @updated="update(item.id)" />
      </template>
    </NVirtualList>
  </LoadState>
  <div v-if="items.length > 0" class="list-footer">
    <span v-if="loading">正在加载…</span>
    <NButton v-else-if="error" @click="load">{{ error }} · 重试</NButton>
    <NButton v-else-if="next !== null" text @click="load">继续加载</NButton>
    <span v-else>已显示全部 {{ items.length }} 项资源</span>
  </div>
</template>

<style scoped>
.resource-list {
  height: calc(100dvh - 290px);
  min-height: 320px;
  border: 1px solid #e8edf2;
  border-radius: 8px;
}
.list-footer {
  text-align: center;
  padding: 16px;
  color: #8592a2;
}
</style>
