<script setup lang="ts">
import type { ResourceKind } from "@yanqi/bot";
import { useDialog } from "naive-ui";
import { ref } from "vue";

import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { useWorkspace } from "~/composables/useWorkspace";
import type { ResourceStats } from "~/types/api";
import { api } from "~/utils/api";

const { data, loading, error, refresh } =
  useApiData<ResourceStats>("storage/resources");
const { status } = useWorkspace();
const { busy, run } = useAction();
const dialog = useDialog();
const result = ref("");
const labels: Record<
  ResourceKind,
  { title: string; description: string; action: string }
> = {
  images: {
    title: "图片原件",
    description: "删除原图，保留识图描述。消息和纪要中的图片位置会显示已清理。",
    action: "清理原图",
  },
  imageDescriptions: {
    title: "识图缓存",
    description:
      "只清除图片识别结果，保留原图、消息和已有纪要。需要时可逐张重新识别。",
    action: "清除识图缓存",
  },
  files: {
    title: "普通文件",
    description: "删除已下载的文件。消息与纪要保留，文件将无法下载。",
    action: "清理文件",
  },
  audio: {
    title: "音频原件",
    description: "删除音频，保留已有语音转写文字。",
    action: "清理音频",
  },
  transcriptions: {
    title: "语音转写缓存",
    description: "只清除转写结果，保留音频原件与已有纪要。",
    action: "清除转写缓存",
  },
  video: {
    title: "视频原件",
    description: "删除视频文件，保留原消息和纪要。",
    action: "清理视频",
  },
  forwards: {
    title: "转发内容缓存",
    description:
      "清除下载展开的转发内容；卡片内的图片等附件需分别清理。原消息内自带的内容保留。",
    action: "清除转发缓存",
  },
};
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
function clear(kind: ResourceKind) {
  const item = labels[kind];
  dialog.warning({
    title: item.action,
    content: `将清理所有群的${item.title}，包括仍被引用的资源。${item.description} 此操作无法撤销。`,
    positiveText: "确认清理",
    negativeText: "取消",
    onPositiveClick: () =>
      run(async () => {
        const cleared = await api<{ files: number; bytes: number }>(
          "storage/resources/clear",
          { method: "POST", body: { kind } },
        );
        result.value = `${item.title}已清理：移除 ${cleared.files} 个文件，释放 ${size(cleared.bytes)}。`;
        await refresh();
      }),
  });
}
</script>

<template>
  <section class="resources-panel">
    <div class="intro">
      <div>
        <h2>资源管理</h2>
        <p>
          所有群共用的存储空间。相同文件只占一份空间，清理会影响它在各群的所有引用。
        </p>
      </div>
      <NButton :loading @click="refresh">刷新用量</NButton>
    </div>
    <NAlert v-if="status?.running" :bordered="false" type="info">
      清理前请先在右上角暂停
      AI，等待当前处理结束，避免正在读取的资源被删除。清理后可恢复 AI。
    </NAlert>
    <NAlert v-if="result" :bordered="false" type="success">{{ result }}</NAlert>
    <LoadState :error :loading @retry="refresh">
      <div class="resources-grid">
        <article v-for="item in data" :key="item.kind" class="resource-card">
          <h3>{{ labels[item.kind].title }}</h3>
          <strong class="size">{{ size(item.bytes) }}</strong>
          <span class="count">
            {{ item.files }} 个文件 · {{ item.references }} 处引用
          </span>
          <p>{{ labels[item.kind].description }}</p>
          <NButton
            :disabled="
              status?.running !== false || (!item.files && !item.references)
            "
            :loading="busy"
            secondary
            :type="
              ['imageDescriptions', 'transcriptions', 'forwards'].includes(
                item.kind,
              )
                ? 'default'
                : 'error'
            "
            @click="clear(item.kind)"
          >
            {{ labels[item.kind].action }}
          </NButton>
        </article>
      </div>
    </LoadState>
    <p class="footnote">
      清理立即生效，不修改消息、纪要或记忆。识别缓存被清理后不会自动补做；重新识别需调用当前配置的模型。用量为附件文件大小，不含数据库、纪要正文和头像缓存。
    </p>
  </section>
</template>

<style scoped>
.intro {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}
.intro p,
.footnote {
  margin-top: 8px;
  color: #798899;
}
.resources-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
  gap: 18px;
  margin: 20px 0;
}
.resource-card {
  padding: 22px;
  background: white;
  border: 1px solid #e2e8ef;
  border-radius: 10px;
  display: flex;
  align-items: flex-start;
  flex-direction: column;
}
.size {
  font-size: 24px;
  margin: 14px 0 4px;
}
.count,
.resource-card p {
  color: #798899;
  font-size: 13px;
}
.resource-card p {
  margin: 16px 0;
  flex: 1;
}
.footnote {
  font-size: 12px;
}
</style>
