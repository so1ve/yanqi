<script setup lang="ts">
import { FileText, Messages, Microphone, Movie, Photo } from "@vicons/tabler";
import { computed } from "vue";

import ResourceRetry from "~/components/resources/ResourceRetry.vue";
import type { Message } from "~/types/api";

const emit = defineEmits<{ updated: [] }>();
const props = defineProps<{
  asset: Message["assets"][number];
  groupId: string;
}>();
const path = computed(
  () => `/api/groups/${props.groupId}/assets/${props.asset.id}`,
);
const kinds = {
  image: { label: "图片", icon: Photo },
  audio: { label: "语音", icon: Microphone },
  video: { label: "视频", icon: Movie },
  file: { label: "文件", icon: FileText },
  forward: { label: "合并转发", icon: Messages },
};
const kind = computed(
  () => kinds[props.asset.previewable ? "image" : props.asset.kind],
);
</script>

<template>
  <section :aria-label="kind.label" class="attachment">
    <StoredImage
      v-if="asset.previewable && asset.downloadable"
      :alt="kind.label"
      class="image"
      :src="`${path}?preview=1`"
    />
    <div class="attachment-bar">
      <span class="attachment-kind">
        <NIcon :component="kind.icon" :size="17" />
        {{ kind.label }}
      </span>
      <a v-if="asset.downloadable" :href="path">下载原件</a>
      <span v-else class="pending">
        {{
          asset.state === "missing"
            ? "原件已清理"
            : asset.state === "pending"
              ? "等待保存"
              : "尚未保存"
        }}
      </span>
    </div>
    <p v-if="asset.error" class="error-text">{{ asset.error }}</p>
    <div class="retry">
      <ResourceRetry :asset :group-id @updated="emit('updated')" />
      <NuxtLink :to="`/${groupId}/resources?q=asset:${asset.id}`">
        资源详情
      </NuxtLink>
    </div>
    <details v-if="asset.interpretation" class="interpretation">
      <summary>查看识别内容</summary>
      <p>{{ asset.interpretation }}</p>
    </details>
  </section>
</template>

<style scoped>
.attachment {
  min-width: min(230px, 100%);
  max-width: 100%;
}

.attachment + .attachment,
.attachment:not(:first-child) {
  margin-top: 12px;
}

.image {
  max-width: 100%;
  margin-bottom: 10px;
}

.image :deep(img) {
  display: block;
  max-width: min(340px, 100%);
  max-height: 280px;
  border-radius: 8px;
}

.attachment-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 24px;
  font-size: 12px;
}

.attachment-kind {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #516779;
}

.attachment-bar a {
  margin-left: auto;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.pending {
  color: #6a7c88;
}

.error-text {
  color: #ab554d;
  font-size: 12px;
  margin-top: 8px;
  overflow-wrap: anywhere;
}

.retry {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  font-size: 12px;
}

.interpretation {
  border-top: 1px solid #dfe8e9;
  margin-top: 10px;
  padding-top: 9px;
  color: #5f7380;
  font-size: 12px;
}

.interpretation summary {
  cursor: pointer;
  width: fit-content;
}

.interpretation p {
  margin-top: 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
}
</style>
