<script setup lang="ts">
import { ref } from "vue";

import UserAvatar from "~/components/UserAvatar.vue";
import MessageContent from "~/components/messages/MessageContent.vue";
import type { Message } from "~/types/api";
import { formatTime } from "~/utils/format";

const emit = defineEmits<{ updated: [] }>();
defineProps<{
  messages: NonNullable<Message["content"][number]["forward"]>;
  assets: Message["assets"];
  groupId: string;
}>();
const opened = ref(false);
function toggle(event: Event): void {
  opened.value = (event.currentTarget as HTMLDetailsElement).open;
}
</script>

<template>
  <details class="forward" @toggle="toggle">
    <summary>查看 {{ messages.length }} 条转发消息</summary>
    <div v-if="opened" class="conversation">
      <article
        v-for="(message, index) in messages"
        :key="index"
        class="forward-message"
      >
        <header>
          <UserAvatar
            v-if="message.userId"
            :name="message.displayName"
            :size="24"
            :user-id="message.userId"
          />
          <strong>{{ message.displayName }}</strong>
          <span class="qq">{{ message.userId }}</span>
          <time
            v-if="message.sentAt"
            :datetime="new Date(message.sentAt).toISOString()"
          >
            {{ formatTime(message.sentAt) }}
          </time>
        </header>
        <div class="body">
          <MessageContent
            :assets
            :content="message.content"
            :group-id
            @updated="emit('updated')"
          />
        </div>
      </article>
      <p v-if="messages.length === 0" class="empty">这张卡片没有消息</p>
    </div>
  </details>
</template>

<style scoped>
.forward {
  margin-top: 8px;
  border: 1px solid #dfe8e9;
  border-radius: 9px;
  background: #f5f8f9;
  min-width: min(260px, 100%);
}
summary {
  padding: 9px 12px;
  color: #37767a;
  font-size: 12px;
  cursor: pointer;
}
.conversation {
  padding: 0 10px 10px;
}
.forward-message {
  min-width: 0;
  border-top: 1px solid #e1e8ec;
  padding-top: 10px;
  margin-top: 8px;
}
.forward-message:first-child {
  margin-top: 0;
}
header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 7px;
  font-size: 12px;
}
strong {
  color: #3a5263;
  overflow-wrap: anywhere;
}
.qq,
time {
  color: #6a7c88;
  font-size: 10px;
}
time {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.body {
  min-width: 0;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid #e1e8ec;
  border-radius: 3px 10px 10px;
  font-size: 13px;
}
.empty {
  font-size: 12px;
  color: #6a7c88;
}
@media (max-width: 760px) {
  .conversation {
    padding: 0 5px 6px;
  }
  .body {
    padding: 6px;
  }
}
</style>
