<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="empty-state">
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
    <slot />
  </div>
</template>

<style scoped>
.empty-state {
  text-align: center;
  padding: 75px 24px;
  color: #8592a2;
}

h3 {
  color: #526376;
  margin-bottom: 10px;
}

p {
  max-width: 420px;
  margin: 0 auto 20px;
  font-size: 13px;
}
</style>
