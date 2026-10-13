<script setup lang="ts">
import { computed } from "vue";

import MessageBubble from "~/components/messages/MessageBubble.vue";
import type { Message } from "~/types/api";
import { formatMessageDay } from "~/utils/format";

defineEmits<{ updated: [] }>();
const props = defineProps<{ message: Message; previous?: Message }>();
const day = computed(() => {
  const day = formatMessageDay(props.message.sentAt);

  return !props.previous || day !== formatMessageDay(props.previous.sentAt)
    ? day
    : null;
});
const continued = computed(
  () =>
    !day.value &&
    props.previous?.userId === props.message.userId &&
    props.message.sentAt - props.previous.sentAt < 120_000,
);
</script>

<template>
  <li class="message-entry">
    <div v-if="day" class="day-divider">
      <span>{{ day }}</span>
    </div>
    <MessageBubble :continued :message @updated="$emit('updated')" />
  </li>
</template>

<style scoped>
.message-entry {
  display: flow-root;
  list-style: none;
}

.day-divider {
  display: flex;
  align-items: center;
  gap: 18px;
  margin: 22px 0 28px;
  color: #687c85;
  font-size: 12px;
  text-align: center;
}

.day-divider::before,
.day-divider::after {
  content: "";
  height: 1px;
  background: #dce5e8;
  flex: 1;
}

@media (max-width: 760px) {
  .day-divider {
    gap: 10px;
    font-size: 11px;
  }
}
</style>
