<script setup lang="ts">
import { useAssetRecognition } from "~/composables/useAssetRecognition";
import type { ImageItem } from "~/types/api";

const emit = defineEmits<{ updated: [] }>();
const props = defineProps<{ asset: ImageItem; groupId: string }>();
const { processing, retry } = useAssetRecognition(
  () => props.groupId,
  () => props.asset.id,
  () => emit("updated"),
);

function onDescriptionWheel(event: WheelEvent) {
  const description = event.currentTarget as HTMLElement;
  const canScroll =
    (event.deltaY < 0 && description.scrollTop > 0) ||
    (event.deltaY > 0 &&
      description.scrollTop + description.clientHeight <
        description.scrollHeight - 1);

  // The virtual list consumes wheel events. Let the description scroll natively
  // until it reaches an edge, and leave pinch-to-zoom to the browser.
  if (canScroll || event.ctrlKey) {
    event.stopPropagation();
  }
}
</script>

<template>
  <article class="image-card">
    <div class="preview">
      <StoredImage
        v-if="asset.available"
        :alt="`图片 #${asset.id}`"
        :src="`/api/groups/${groupId}/assets/${asset.id}?preview=1`"
      />
      <p v-else>
        {{ asset.state === "missing" ? "原图已清理" : "原图尚未保存" }}
      </p>
    </div>
    <div class="description">
      <div class="card-title">
        <strong>图片 #{{ asset.id }}</strong>
        <NuxtLink :to="`/${groupId}/messages?q=m${asset.messageId}`">
          查看原消息 m{{ asset.messageId }}
        </NuxtLink>
      </div>
      <p v-if="asset.error" class="error-text">{{ asset.error }}</p>
      <p class="recognition" @wheel.passive="onDescriptionWheel">
        {{ asset.interpretation || "暂无识图结果" }}
      </p>
      <div class="actions">
        <NButton :loading="processing" size="small" @click="retry">
          {{ asset.state === "missing" ? "重新获取并识别" : "重新识别" }}
        </NButton>
        <a
          v-if="asset.available"
          :href="`/api/groups/${groupId}/assets/${asset.id}`"
        >
          下载原图
        </a>
      </div>
    </div>
  </article>
</template>

<style scoped>
.image-card {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 24px;
  padding: 24px;
  border-bottom: 1px solid #e8edf2;
  background: white;
}
.preview {
  align-self: start;
  color: #8592a2;
}
.preview :deep(img) {
  max-width: 220px;
}
.card-title,
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}
.card-title a,
.actions a {
  font-size: 12px;
}
.recognition {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 14px 0;
  line-height: 1.7;
  max-height: 180px;
  overflow: auto;
}
.error-text {
  color: #ab554d;
}
@media (max-width: 760px) {
  .image-card {
    grid-template-columns: 1fr;
  }
}
</style>
