<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{ src: string; alt: string }>();
const failed = ref(false);
watch(
  () => props.src,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <div class="stored-image">
    <p v-if="failed" class="unavailable" role="status">
      {{ alt }} · 图片已清理或暂不可用
    </p>
    <NImage
      v-else
      :alt
      :img-props="{ loading: 'lazy' }"
      object-fit="contain"
      :src
      @error="failed = true"
    />
  </div>
</template>

<style scoped>
.stored-image :deep(img) {
  display: block;
  max-width: 100%;
  max-height: 280px;
  border-radius: 8px;
}
.unavailable {
  padding: 24px;
  border-radius: 8px;
  background: #f1f5f7;
  color: #738397;
}
</style>
