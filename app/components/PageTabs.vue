<template>
  <NTabs class="page-tabs" type="line"><slot /></NTabs>
</template>

<style scoped>
.page-tabs :deep(> .n-tabs-nav) {
  position: sticky;
  top: calc(var(--topbar-height) + var(--page-heading-height));
  z-index: 21;
  margin-inline: calc(-1 * var(--page-gutter));
  padding-inline: var(--page-gutter);
  background: #f5f7fa;
}
</style>
