<script setup lang="ts">
import { NVirtualList } from "naive-ui";
import {
  nextTick,
  onMounted,
  onScopeDispose,
  ref,
  useTemplateRef,
  watch,
} from "vue";

import MessageEntry from "~/components/messages/MessageEntry.vue";
import type { Message } from "~/types/api";
import type { ReadingPosition } from "~/utils/message-cache";

const emit = defineEmits<{
  updated: [messageId: number];
  loadMore: [];
  position: [position: ReadingPosition];
}>();
const props = defineProps<{ messages: Message[]; loading: boolean }>();
const virtualList =
  useTemplateRef<InstanceType<typeof NVirtualList>>("virtualList");
const interacted = ref(false);
let restoring = false;
let scrollFrame = 0;

function position(): ReadingPosition | undefined {
  const container = virtualList.value?.getScrollContainer();

  if (!container?.clientHeight) {
    return;
  }

  const viewport = container.getBoundingClientRect();
  const entry = [
    ...container.querySelectorAll<HTMLElement>("[data-message-id]"),
  ].find((entry) => entry.getBoundingClientRect().bottom > viewport.top + 1);

  if (entry) {
    return {
      messageId: Number(entry.dataset.messageId),
      offset: viewport.top - entry.getBoundingClientRect().top,
    };
  }
}

async function restore(target: ReadingPosition): Promise<void> {
  restoring = true;
  await nextTick();
  virtualList.value?.scrollTo({ key: target.messageId });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const container = virtualList.value?.getScrollContainer();
  const entry = container?.querySelector<HTMLElement>(
    `[data-message-id="${target.messageId}"]`,
  );

  if (container && entry) {
    container.scrollTop +=
      entry.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      Math.min(target.offset, entry.getBoundingClientRect().height - 1);
  }

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  restoring = false;
}

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

function onScroll(): void {
  loadMore();

  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    if (interacted.value && !restoring) {
      const current = position();

      if (current) {
        emit("position", current);
      }
    }
  });
}

watch(() => props.messages.length, loadMore, { flush: "post" });
watch(
  () => props.loading,
  (loading) => {
    if (!loading) {
      loadMore();
    }
  },
  { flush: "post" },
);
onScopeDispose(() => cancelAnimationFrame(scrollFrame));
onMounted(() =>
  virtualList.value?.getScrollContainer()?.setAttribute("tabindex", "0"),
);
defineExpose({ position, restore });
</script>

<template>
  <section
    aria-label="聊天记录"
    class="conversation"
    @keydown="interacted = true"
    @pointerdown="interacted = true"
    @touchstart.passive="interacted = true"
    @wheel.passive="interacted = true"
  >
    <NImageGroup>
      <NVirtualList
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
        @scroll="onScroll"
      >
        <template #default="{ item, index }">
          <MessageEntry
            :message="item"
            :previous="messages[index - 1]"
            @updated="emit('updated', item.id)"
          />
        </template>
      </NVirtualList>
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
