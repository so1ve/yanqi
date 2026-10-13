<script setup lang="ts">
defineEmits<{ retry: [] }>();
defineProps<{
  error?: string;
  loading?: boolean;
  empty?: boolean;
  title?: string;
  description?: string;
}>();
</script>

<template>
  <NAlert v-if="error" :bordered="false" class="load-error" type="error">
    {{ error }}
    <template #action>
      <NButton size="small" @click="$emit('retry')">重试</NButton>
    </template>
  </NAlert>
  <div v-else-if="loading" class="loading-state">
    <NSpin size="small" />
    <span>加载中…</span>
  </div>
  <EmptyState v-else-if="empty" :description :title="title || '还没有内容'">
    <slot name="action" />
  </EmptyState>
  <slot v-else />
</template>

<style scoped>
.loading-state {
  display: flex;
  gap: 12px;
  justify-content: center;
  padding: 70px 20px;
  color: #8592a2;
}

.load-error {
  margin-bottom: 20px;
}
</style>
