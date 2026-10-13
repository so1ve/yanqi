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
  <div v-else-if="empty" class="empty-state">
    <h3>{{ title || "还没有内容" }}</h3>
    <p>{{ description }}</p>
    <slot name="action" />
  </div>
  <slot v-else />
</template>
