<script setup lang="ts">
import { ArrowDown } from "@vicons/tabler";
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
const props = defineProps<{
  messages: Message[];
  loading: boolean;
  fromLatest?: boolean;
}>();
const virtualList =
  useTemplateRef<InstanceType<typeof NVirtualList>>("virtualList");
const following = ref(Boolean(props.fromLatest));
// 阅读书签沿用整行偏移；实时定位气泡，避免补载后日期和昵称的变化挤动正文。
let anchor: (ReadingPosition & { bubble?: boolean }) | undefined;
let interacted = false;
let scrolling = false;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
let contentObserver: ResizeObserver | undefined;
let scrollFrame = 0;
let anchorFrame = 0;

function visibleEntry(container: HTMLElement): HTMLElement | undefined {
  const top = container.getBoundingClientRect().top;

  return [...container.querySelectorAll<HTMLElement>("[data-message-id]")].find(
    (entry) => entry.getBoundingClientRect().bottom > top + 1,
  );
}

function rememberPosition(): void {
  const container = virtualList.value?.getScrollContainer();
  const entry = container?.clientHeight ? visibleEntry(container) : undefined;

  if (interacted && container && entry) {
    emit("position", {
      messageId: Number(entry.dataset.messageId),
      offset:
        container.getBoundingClientRect().top -
        entry.getBoundingClientRect().top,
    });
  }
}

function capturePosition(): void {
  const container = virtualList.value?.getScrollContainer();

  if (!container?.clientHeight) {
    return;
  }

  const viewport = container.getBoundingClientRect();
  const entry = visibleEntry(container);

  following.value = Boolean(
    props.fromLatest &&
    container.scrollHeight - container.scrollTop - container.clientHeight < 8,
  );

  if (entry) {
    const body = entry.querySelector<HTMLElement>(".bubble")!;
    anchor = {
      messageId: Number(entry.dataset.messageId),
      offset: viewport.top - body.getBoundingClientRect().top,
      bubble: true,
    };

    rememberPosition();
  }
}

function alignAnchor(): void {
  const container = virtualList.value?.getScrollContainer();

  if (!container?.clientHeight) {
    return;
  }

  if (following.value) {
    virtualList.value?.scrollTo({ position: "bottom" });

    return;
  }

  if (!anchor) {
    return;
  }

  const entry = container.querySelector<HTMLElement>(
    `[data-message-id="${anchor.messageId}"]`,
  );

  if (entry) {
    const body = anchor.bubble
      ? entry.querySelector<HTMLElement>(".bubble")!
      : entry;
    const bounds = body.getBoundingClientRect();
    const delta =
      bounds.top -
      container.getBoundingClientRect().top +
      Math.min(anchor.offset, bounds.height - 1);

    if (Math.abs(delta) > 0.5) {
      container.scrollTop += delta;
    }
  } else {
    virtualList.value?.scrollTo({ key: anchor.messageId, debounce: false });
  }
}

function keepPosition(): void {
  if (scrolling) {
    return;
  }

  cancelAnimationFrame(scrollFrame);
  cancelAnimationFrame(anchorFrame);
  alignAnchor();
  anchorFrame = requestAnimationFrame(() => {
    alignAnchor();
    anchorFrame = 0;
    rememberPosition();
    loadMore();
  });
}

async function restore(target: ReadingPosition): Promise<void> {
  stopScrolling();
  interacted = true;
  following.value = false;
  anchor = target;
  await nextTick();
  keepPosition();
}

function latest(): void {
  stopScrolling();
  interacted = true;
  following.value = true;
  anchor = undefined;
  keepPosition();
}

function stopScrolling(): void {
  clearTimeout(scrollTimer);
  scrolling = false;
}

function interact(event: Event): void {
  if (
    event instanceof KeyboardEvent &&
    ![
      " ",
      "ArrowDown",
      "ArrowUp",
      "End",
      "Home",
      "PageDown",
      "PageUp",
    ].includes(event.key)
  ) {
    return;
  }

  if (
    event instanceof PointerEvent &&
    !(event.target as HTMLElement).closest(".n-scrollbar-rail")
  ) {
    return;
  }

  interacted = true;
  scrolling = true;
  following.value = false;
  anchor = undefined;
  cancelAnimationFrame(anchorFrame);
  anchorFrame = 0;
  onScroll();
}

function loadMore(): void {
  const container = virtualList.value?.getScrollContainer();

  if (
    !props.loading &&
    container?.clientHeight &&
    (props.fromLatest
      ? container.scrollTop
      : container.scrollHeight - container.scrollTop - container.clientHeight) <
      400
  ) {
    emit("loadMore");
  }
}

function onScroll(): void {
  // 虚拟列表也会主动修正 scrollTop，只有用户滚动才更新阅读锚点。
  if (!scrolling) {
    return;
  }

  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    stopScrolling();
    keepPosition();
  }, 150);
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    capturePosition();
    loadMore();
  });
}

watch(
  () => props.messages,
  () => {
    stopScrolling();
    if (!following.value) {
      capturePosition();
    }

    void nextTick(keepPosition);
  },
);
watch(
  () => props.loading,
  (loading) => {
    if (!loading) {
      keepPosition();
    }
  },
  { flush: "post" },
);
onMounted(() => {
  virtualList.value?.getScrollContainer()?.setAttribute("tabindex", "0");
  const content = virtualList.value?.getScrollContent();

  contentObserver = new ResizeObserver(keepPosition);

  if (content) {
    contentObserver.observe(content);
  }

  if (!props.fromLatest) {
    capturePosition();
  }

  keepPosition();
});
onScopeDispose(() => {
  stopScrolling();
  cancelAnimationFrame(scrollFrame);
  cancelAnimationFrame(anchorFrame);
  contentObserver?.disconnect();
});
defineExpose({ restore });
</script>

<template>
  <section
    aria-label="聊天记录"
    class="conversation"
    @keydown="interact"
    @pointerdown="interact"
    @touchstart.passive="interact"
    @wheel.passive="interact"
  >
    <NImageGroup>
      <NVirtualList
        ref="virtualList"
        class="virtual-messages"
        :class="{ 'from-latest': fromLatest }"
        :default-scroll-key="fromLatest ? messages.at(-1)?.id : undefined"
        item-resizable
        :item-size="48"
        :items="messages"
        :items-style="{ maxWidth: '980px', margin: '0 auto' }"
        key-field="id"
        :padding-bottom="4"
        visible-items-tag="ol"
        @resize="keepPosition"
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
    <NButton
      v-if="fromLatest && !following"
      class="latest-button"
      round
      size="small"
      @click="latest"
    >
      <template #icon><NIcon :component="ArrowDown" /></template>
      回到最新消息
    </NButton>
  </section>
</template>

<style scoped>
.conversation {
  position: relative;
  padding: 12px 28px 28px;
  border: 1px solid #e1e9ed;
  border-radius: 14px;
  background: #f1f5f6;
}

.virtual-messages {
  max-height: min(70dvh, 900px);
}

.virtual-messages :deep(.v-vl) {
  overflow-anchor: none;
}

.virtual-messages.from-latest {
  height: min(70dvh, 900px);
}

.latest-button {
  position: absolute;
  right: 40px;
  bottom: 40px;
  box-shadow: 0 3px 14px #183d4426;
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

  .latest-button {
    right: 24px;
    bottom: 32px;
  }
}
</style>
