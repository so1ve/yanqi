<template>
  <article class="reader"><slot /></article>
</template>

<style scoped>
.reader {
  background: white;
  padding: 36px 44px;
  border: 1px solid #e2e8ef;
  border-radius: 7px;
  max-width: 1000px;
  margin: 0 auto;
}

@media (max-width: 760px) {
  .reader {
    padding: 24px 20px;
  }
}
</style>
