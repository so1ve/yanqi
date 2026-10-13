<script setup lang="ts">
import { computed } from "vue";

import MessageBubble from "~/components/messages/MessageBubble.vue";
import type { Message } from "~/types/api";
import { formatMessageDay } from "~/utils/format";

const emit = defineEmits<{ updated: [] }>();
const props = defineProps<{ messages: Message[] }>();
const entries = computed(() => {
  const messages = props.messages.toSorted(
    (a, b) => a.sentAt - b.sentAt || a.id - b.id,
  );

  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const day = formatMessageDay(message.sentAt);
    const newDay = !previous || day !== formatMessageDay(previous.sentAt);

    return {
      message,
      day: newDay ? day : null,
      continued:
        !newDay &&
        previous?.userId === message.userId &&
        message.sentAt - previous.sentAt < 120_000,
    };
  });
});
</script>

<template>
  <section aria-label="聊天记录" class="conversation">
    <NImageGroup>
      <ol class="messages">
        <li v-for="entry in entries" :key="entry.message.id">
          <div v-if="entry.day" class="day-divider">
            <span>{{ entry.day }}</span>
          </div>
          <MessageBubble
            :continued="entry.continued"
            :message="entry.message"
            @updated="emit('updated')"
          />
        </li>
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
  .conversation {
    padding: 4px 12px 20px;
  }

  .day-divider {
    gap: 10px;
    font-size: 11px;
  }
}
</style>
