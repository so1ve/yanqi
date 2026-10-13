<script setup lang="ts">
defineProps<{ total: number }>();
const page = defineModel<number>("page", { required: true });
</script>

<template>
  <footer class="pagination">
    <span><slot /></span>
    <NPagination v-model:page="page" :item-count="total" :page-size="30" />
  </footer>
</template>

<style scoped>
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
  font-size: 12px;
  color: #8a97a7;
}

@media (max-width: 760px) {
  .pagination {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
