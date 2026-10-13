<script setup lang="ts">
import { NVirtualList } from "naive-ui";
import { computed, useTemplateRef, watch } from "vue";

import MessageEntry from "~/components/messages/MessageEntry.vue";
import type { Message } from "~/types/api";

const emit = defineEmits<{ updated: [messageId: number]; loadMore: [] }>();
const props = defineProps<{ messages: Message[]; virtual?: boolean }>();
const virtualList =
  useTemplateRef<InstanceType<typeof NVirtualList>>("virtualList");
const messages = computed(() =>
  props.messages.toSorted((a, b) => a.sentAt - b.sentAt || a.id - b.id),
);

function loadMore(): void {
  const container = virtualList.value?.getScrollContainer();

  if (
    container &&
    container.clientHeight > 0 &&
    container.scrollHeight - container.scrollTop - container.clientHeight < 400
  ) {
    emit("loadMore");
  }
}

watch(() => props.messages.length, loadMore, { flush: "post" });
</script>

<template>
  <section aria-label="聊天记录" class="conversation">
    <NImageGroup>
      <NVirtualList
        v-if="virtual"
        ref="virtualList"
        class="virtual-messages"
        item-resizable
        :item-size="48"
        :items="messages"
        :items-style="{ maxWidth: '980px', margin: '0 auto' }"
        key-field="id"
        :padding-bottom="4"
        visible-items-tag="ol"
        @resize="loadMore"
        @scroll="loadMore"
      >
        <template #default="{ item, index }">
          <MessageEntry
            :message="item"
            :previous="messages[index - 1]"
            @updated="emit('updated', item.id)"
          />
        </template>
      </NVirtualList>
      <ol v-else class="messages">
        <MessageEntry
          v-for="(message, index) in messages"
          :key="message.id"
          :message
          :previous="messages[index - 1]"
          @updated="emit('updated', message.id)"
        />
      </ol>
    </NImageGroup>
  </section>
</template>

<style scoped>
.conversation {
  padding: 12px 28px 28px;
  border: 1px solid #e1e9ed;
  border-radius: 14px;
  background: #f1f5f6;
}

.messages {
  max-width: 980px;
  margin: 0 auto;
  padding: 0;
  list-style: none;
}

.virtual-messages {
  max-height: min(70dvh, 900px);
}

.virtual-messages :deep(ol) {
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 760px) {
  .conversation {
    padding: 4px 12px 20px;
  }
}
</style>
