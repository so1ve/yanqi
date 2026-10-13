<script setup lang="ts">
withDefaults(defineProps<{ as?: "form" | "div" }>(), { as: "div" });
</script>

<template>
  <component :is="as" class="toolbar"><slot /></component>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 20px;
}

:slotted(.search) {
  max-width: 340px;
  width: 100%;
}

:slotted(.right) {
  margin-left: auto;
}

@media (max-width: 760px) {
  .toolbar {
    flex-wrap: wrap;
  }
  :slotted(.search) {
    max-width: none;
  }
}
</style>
