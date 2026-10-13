<script setup lang="ts">
const emit = defineEmits<{ close: [] }>();
withDefaults(defineProps<{ title: string; width?: number }>(), { width: 550 });
</script>

<template>
  <NModal show @update:show="emit('close')">
    <NCard
      aria-modal="true"
      :bordered="false"
      class="dialog"
      closable
      role="dialog"
      :style="{ maxWidth: `${width}px` }"
      :title
      @close="emit('close')"
    >
      <slot />
    </NCard>
  </NModal>
</template>

<style scoped>
.dialog {
  width: calc(100vw - 32px);
}
</style>
