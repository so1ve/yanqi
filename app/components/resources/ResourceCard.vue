<script setup lang="ts">
import { FileText, Messages, Microphone, Movie, Photo } from "@vicons/tabler";
import { computed, onScopeDispose, ref } from "vue";

import MessageContent from "~/components/messages/MessageContent.vue";
import ResourceRetry from "~/components/resources/ResourceRetry.vue";
import type { Message, ResourceItem } from "~/types/api";
import { api, errorText } from "~/utils/api";
import { formatTime } from "~/utils/format";
import { assetKindNames } from "~/utils/labels";

const emit = defineEmits<{ updated: [] }>();
const props = defineProps<{ asset: ResourceItem; groupId: string }>();
const icons = {
  image: Photo,
  audio: Microphone,
  video: Movie,
  file: FileText,
  forward: Messages,
};
const path = computed(
  () => `/api/groups/${props.groupId}/assets/${props.asset.id}`,
);
const mediaFailed = ref(false);
const opened = ref(false);
const source = ref<Message>();
const loading = ref(false);
const error = ref("");
const controller = new AbortController();
onScopeDispose(() => controller.abort());

async function loadForward() {
  opened.value = true;
  loading.value = true;
  error.value = "";
  try {
    const messages = await api<Message[]>(
      `groups/${props.groupId}/messages/read`,
      {
        method: "POST",
        body: { ids: [props.asset.messageId] },
        signal: controller.signal,
      },
    );
    source.value = messages[0];
  } catch (cause) {
    if (!controller.signal.aborted) {
      error.value = errorText(cause);
    }
  } finally {
    loading.value = false;
  }
}

function updated() {
  mediaFailed.value = false;
  emit("updated");
}

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
  <article class="resource-card">
    <div class="preview">
      <StoredImage
        v-if="asset.previewable && asset.downloadable"
        :alt="`图片 #${asset.id}`"
        :src="`${path}?preview=1`"
      />
      <template v-else>
        <NIcon :component="icons[asset.kind]" :size="40" />
        <audio
          v-if="asset.kind === 'audio' && asset.downloadable && !mediaFailed"
          controls
          preload="none"
          :src="`${path}?preview=1`"
          @error="mediaFailed = true"
        />
        <video
          v-else-if="
            asset.kind === 'video' && asset.downloadable && !mediaFailed
          "
          controls
          preload="none"
          :src="`${path}?preview=1`"
          @error="mediaFailed = true"
        />
        <p v-if="!asset.downloadable">
          {{ asset.state === "missing" ? "原件已清理" : "原件尚未保存" }}
        </p>
        <p v-else-if="mediaFailed">浏览器暂时无法播放，可下载原件。</p>
      </template>
    </div>
    <div class="description">
      <div class="card-title">
        <strong>{{ assetKindNames[asset.kind] }} #{{ asset.id }}</strong>
        <StateTag
          v-if="asset.taskState === 'pending' || asset.taskState === 'running'"
          :state="asset.taskState"
        />
        <NTag
          v-else
          :bordered="false"
          round
          size="small"
          :type="asset.error && asset.state !== 'missing' ? 'error' : 'default'"
        >
          {{
            asset.state === "missing"
              ? "原件已清理"
              : asset.error
                ? "处理失败"
                : asset.downloadable
                  ? "已保存"
                  : "待获取"
          }}
        </NTag>
        <NuxtLink :to="`/${groupId}/messages?q=m${asset.messageId}`">
          查看原消息 m{{ asset.messageId }}
        </NuxtLink>
      </div>
      <p class="time">{{ formatTime(asset.sentAt) }}</p>
      <p v-if="asset.error" class="error-text">{{ asset.error }}</p>
      <p class="recognition" @wheel.passive="onDescriptionWheel">
        {{
          asset.interpretation ||
          (asset.kind === "forward"
            ? "展开查看转发消息及其中的图片、语音和文件。"
            : asset.kind === "audio"
              ? "暂无转写结果"
              : asset.kind === "image"
                ? "暂无识图结果"
                : "保留原文件，暂不提供内容识别。")
        }}
      </p>
      <div class="actions">
        <ResourceRetry :asset :group-id @updated="updated" />
        <NButton
          v-if="asset.kind === 'forward'"
          size="small"
          @click="loadForward"
        >
          查看转发
        </NButton>
        <a v-if="asset.downloadable" :href="path">下载原件</a>
      </div>
    </div>
  </article>
  <NDrawer v-model:show="opened" width="min(720px, 100vw)">
    <NDrawerContent closable :title="`合并转发 #${asset.id}`">
      <LoadState
        :empty="!source"
        :error
        :loading
        title="原消息已清理"
        @retry="loadForward"
      >
        <MessageContent
          v-if="source"
          :assets="source.assets"
          :content="source.content"
          :group-id
          @updated="
            loadForward();
            emit('updated');
          "
        />
      </LoadState>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.resource-card {
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
.preview audio,
.preview video {
  display: block;
  width: 100%;
  margin-top: 16px;
}
.preview p,
.time {
  margin-top: 8px;
  color: #8592a2;
  font-size: 12px;
}
.description {
  min-width: 0;
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
  .resource-card {
    grid-template-columns: 1fr;
  }
}
</style>
