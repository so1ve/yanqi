<script setup lang="ts">
import { onMounted, onScopeDispose, useTemplateRef } from "vue";

defineProps<{ title: string; description?: string }>();

const heading = useTemplateRef<HTMLElement>("heading");
let observer: ResizeObserver | undefined;
let content: HTMLElement | null = null;

onMounted(() => {
  const element = heading.value!;
  content = element.closest("main");
  // 标题和筛选换行后，标签栏仍紧贴操作区下方。
  observer = new ResizeObserver(() => {
    content?.style.setProperty(
      "--page-heading-height",
      `${element.getBoundingClientRect().height}px`,
    );
  });
  observer.observe(element);
});

onScopeDispose(() => {
  observer?.disconnect();
  content?.style.removeProperty("--page-heading-height");
});
</script>

<template>
  <header ref="heading" class="page-heading">
    <div class="heading-row">
      <div class="heading-title">
        <h1>{{ title }}</h1>
        <p v-if="description">{{ description }}</p>
      </div>
      <div v-if="$slots.default" class="heading-actions"><slot /></div>
    </div>
    <div v-if="$slots.toolbar" class="heading-toolbar">
      <slot name="toolbar" />
    </div>
  </header>
</template>

<style scoped>
.page-heading {
  position: sticky;
  top: var(--topbar-height);
  z-index: 22;
  margin: -12px calc(-1 * var(--page-gutter)) 20px;
  padding: 12px var(--page-gutter);
  background: #f5f7fa;
  border-bottom: 1px solid #e2e8ef;
}

.heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.heading-title {
  min-width: 0;
  overflow-wrap: anywhere;
}

.page-heading p {
  margin-top: 7px;
  font-size: 13px;
  color: #8592a2;
}

.heading-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.heading-toolbar {
  margin-top: 18px;
}

.heading-toolbar :deep(.toolbar) {
  margin-bottom: 0;
}

@media (max-width: 760px) {
  .heading-row {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 15px;
  }
}
</style>
