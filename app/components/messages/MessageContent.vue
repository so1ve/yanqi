<script setup lang="ts">
import { computed } from "vue";

import MessageAttachment from "~/components/messages/MessageAttachment.vue";
import MessageForward from "~/components/messages/MessageForward.vue";
import type { Message } from "~/types/api";

const emit = defineEmits<{ updated: [] }>();
const props = defineProps<{
  content: Message["content"];
  assets: Message["assets"];
  groupId: string;
}>();
const parts = computed(() =>
  props.content
    .filter((segment) => segment.type !== "reply")
    .map((segment) => ({
      segment,
      asset: props.assets.find((asset) => asset.id === segment.assetId),
    })),
);
</script>

<template>
  <template v-for="({ segment, asset }, index) in parts" :key="index">
    <span v-if="segment.type === 'text'" class="message-text">
      {{ segment.data.text }}
    </span>
    <span
      v-else-if="segment.type === 'at'"
      class="marker"
      :title="segment.data.qq === 'all' ? undefined : String(segment.data.qq)"
    >
      @{{ segment.data.name }}
    </span>
    <span v-else-if="segment.type === 'face'" class="marker">
      [表情 {{ segment.data.id }}]
    </span>
    <section v-else-if="segment.type === 'forward'" class="forward-content">
      <MessageAttachment
        v-if="asset"
        :asset
        :group-id
        @updated="emit('updated')"
      />
      <MessageForward
        v-if="segment.forward"
        :assets
        :group-id
        :messages="segment.forward"
        @updated="emit('updated')"
      />
      <p v-if="segment.forwardError" class="error-text">
        {{ segment.forwardError }}
      </p>
      <p v-else-if="!segment.forward && !asset" class="pending">
        转发内容尚未读取
      </p>
    </section>
    <MessageAttachment
      v-else-if="asset"
      :asset
      :group-id
      @updated="emit('updated')"
    />
    <details v-else class="segment">
      <summary>{{ segment.type }} 消息</summary>
      <pre>{{ JSON.stringify(segment.data, null, 2) }}</pre>
    </details>
  </template>
</template>

<style scoped>
.message-text {
  color: #293c49;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
}
.marker {
  padding: 1px 6px;
  border-radius: 4px;
  color: #37767a;
  background: #eef5f5;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.forward-content {
  margin-top: 8px;
  max-width: 100%;
}
.forward-content:first-child {
  margin-top: 0;
}
.segment {
  margin-top: 8px;
  color: #617482;
  font-size: 12px;
}
.segment summary {
  cursor: pointer;
}
.segment pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.error-text {
  color: #ab554d;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.pending {
  color: #6a7c88;
  font-size: 12px;
}
</style>
