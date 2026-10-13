<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <header class="page-heading">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div class="heading-actions"><slot /></div>
  </header>
</template>

<style scoped>
.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 27px;
  gap: 20px;
}

.page-heading p {
  margin-top: 7px;
  font-size: 13px;
  color: #8592a2;
}

.heading-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

@media (max-width: 760px) {
  .page-heading {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 15px;
  }

  .heading-actions {
    flex-wrap: wrap;
  }
}
</style>
