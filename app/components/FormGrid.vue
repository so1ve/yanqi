<template>
  <div class="form-grid"><slot /></div>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 22px;
}

:slotted(.full-width) {
  grid-column: 1 / -1;
}

@media (max-width: 760px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
