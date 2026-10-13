<script setup lang="ts">
defineProps<{ padded?: boolean }>();
</script>

<template>
  <section class="panel" :class="{ padded }">
    <header v-if="$slots.header" class="panel-header">
      <slot name="header" />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid #e2e8ef;
  border-radius: 8px;
  overflow: hidden;
}

.padded {
  padding: 24px;
}

.panel-header {
  padding: 20px 24px;
  border-bottom: 1px solid #ecf0f4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
}
</style>
