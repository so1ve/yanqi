<script setup lang="ts">
import { CornerUpLeft, Robot } from "@vicons/tabler";
import { computed } from "vue";

import MessageAttachment from "~/components/messages/MessageAttachment.vue";
import type { Message } from "~/types/api";
import { formatMessageTime, formatTime } from "~/utils/format";

const emit = defineEmits<{ updated: [] }>();
const props = defineProps<{ message: Message; continued: boolean }>();
const hue = computed(() => Number(props.message.userId) % 360);
const parts = computed(() =>
  props.message.content
    .filter((segment) => segment.type !== "reply")
    .map((segment) => ({
      segment,
      asset: props.message.assets.find(
        (asset) =>
          asset.kind === (segment.type === "record" ? "audio" : segment.type) &&
          asset.reference ===
            String(
              [
                segment.data.url,
                segment.data.id,
                segment.data.file_id,
                segment.data.file,
              ].find(Boolean) ?? "",
            ),
      ),
    })),
);
</script>

<template>
  <article
    :aria-label="`${message.displayName}，${formatMessageTime(message.sentAt)}`"
    class="message"
    :class="{ 'from-bot': message.isBot, continued }"
  >
    <div aria-hidden="true" class="avatar" :style="{ '--avatar-hue': hue }">
      <NIcon v-if="message.isBot" :component="Robot" :size="21" />
      <span v-else>{{ Array.from(message.displayName)[0] }}</span>
    </div>
    <div class="message-main">
      <header v-if="!continued" class="sender">
        <strong>{{ message.displayName }}</strong>
        <span v-if="message.isBot" class="bot-label">机器人</span>
        <span class="qq">{{ message.userId }}</span>
      </header>
      <div class="bubble">
        <div v-if="message.replyTo" class="quote">
          <span class="quote-author">
            <NIcon :component="CornerUpLeft" :size="14" />
            {{
              message.quote ? `回复 ${message.quote.displayName}` : "引用消息"
            }}
            <span v-if="message.quote?.recalledAt">· 已撤回</span>
          </span>
          <p>
            {{
              message.quote
                ? message.quote.text || "非文字消息"
                : "这条引用未在本地保留"
            }}
          </p>
        </div>
        <p
          v-if="
            message.text &&
            !parts.some(({ segment }) => segment.type === 'text')
          "
          class="message-text"
        >
          {{ message.text }}
        </p>
        <template v-for="({ segment, asset }, index) in parts" :key="index">
          <span v-if="segment.type === 'text'" class="message-text">
            {{ segment.data.text }}
          </span>
          <span v-else-if="segment.type === 'at'" class="marker">
            @{{ segment.data.qq === "all" ? "全体成员" : segment.data.qq }}
          </span>
          <span v-else-if="segment.type === 'face'" class="marker">
            [表情 {{ segment.data.id }}]
          </span>
          <MessageAttachment
            v-else-if="asset"
            :asset
            :group-id="message.groupId"
            @updated="emit('updated')"
          />
          <details v-else class="segment">
            <summary>{{ segment.type }} 消息</summary>
            <pre>{{ JSON.stringify(segment.data, null, 2) }}</pre>
          </details>
        </template>
        <p
          v-if="
            !message.text &&
            message.content.length === 0 &&
            message.assets.length === 0
          "
          class="empty-content"
        >
          无文字内容
        </p>
      </div>
      <footer class="message-footer">
        <time :datetime="new Date(message.sentAt).toISOString()">
          {{ formatMessageTime(message.sentAt) }}
        </time>
        <span class="message-id" :title="`QQ 消息号：${message.messageId}`">
          m{{ message.id }}
        </span>
        <span
          v-if="message.recalledAt"
          class="recalled"
          :title="`撤回时间：${formatTime(message.recalledAt)}`"
        >
          已撤回 · 原文已保留
        </span>
      </footer>
    </div>
  </article>
</template>

<style scoped>
.message {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 24px;
}

.continued {
  margin-top: 9px;
}

.avatar {
  flex: 0 0 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: hsl(var(--avatar-hue) 35% 89%);
  color: hsl(var(--avatar-hue) 30% 33%);
  font-size: 16px;
  font-weight: 600;
}

.continued .avatar {
  visibility: hidden;
}

.message-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  max-width: min(84%, 760px);
}

.sender {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin: 0 2px 7px;
  font-size: 12px;
}

.sender strong {
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.qq {
  color: #6a7c88;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.bot-label {
  color: #277f80;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #dfeeea;
}

.bubble {
  min-width: 70px;
  max-width: 100%;
  padding: 12px 16px;
  border: 1px solid #e1e8ec;
  border-radius: 3px 15px 15px;
  background: white;
  box-shadow: 0 2px 3px #263b4905;
}

.message-text {
  color: #293c49;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
}

.quote {
  margin: 0 0 10px;
  padding: 8px 11px;
  border-left: 3px solid #a9c6c5;
  border-radius: 3px 7px 7px 3px;
  background: #f1f5f6;
  color: #617482;
  font-size: 12px;
}

.quote-author {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 500;
}

.quote p {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  margin-top: 3px;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.message-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  padding: 4px 3px 0;
  color: #687c88;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.message-id {
  color: #7d8b95;
}

.recalled {
  color: #99702d;
}

.marker {
  padding: 1px 6px;
  border-radius: 4px;
  color: #37767a;
  background: #eef5f5;
  font-size: 12px;
  overflow-wrap: anywhere;
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

.empty-content {
  color: #687c88;
  font-size: 12px;
}

.from-bot {
  flex-direction: row-reverse;
}

.from-bot .avatar {
  color: #fff;
  background: #277f80;
}

.from-bot .message-main {
  align-items: flex-end;
}

.from-bot .sender,
.from-bot .message-footer {
  justify-content: flex-end;
}

.from-bot .bubble {
  background: #e5f2ee;
  border-color: #cfe4dd;
  border-radius: 15px 3px 15px 15px;
}

.from-bot .quote {
  background: #d8eae5;
}

@media (max-width: 760px) {
  .message {
    gap: 8px;
  }

  .avatar {
    flex-basis: 30px;
    height: 30px;
    border-radius: 9px;
    font-size: 14px;
  }

  .message-main {
    max-width: calc(100% - 38px);
  }

  .bubble {
    padding: 10px 12px;
  }
}
</style>
