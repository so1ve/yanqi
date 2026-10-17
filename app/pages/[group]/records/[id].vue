<script setup lang="ts">
import {
  ArrowLeft,
  Download,
  Edit,
  Refresh,
  Send,
  Trash,
} from "@vicons/tabler";
import { useDialog } from "naive-ui";
import { computed, ref } from "vue";

import { navigateTo, useRoute } from "#imports";
import NoteEditor from "~/components/records/NoteEditor.vue";
import RecordReader from "~/components/records/RecordReader.vue";
import RecordStatus from "~/components/records/RecordStatus.vue";
import RegenerateDialog from "~/components/records/RegenerateDialog.vue";
import TranscriptView from "~/components/records/TranscriptView.vue";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { usePoll } from "~/composables/usePoll";
import { positiveInteger, useQueryValue } from "~/composables/useQueryValue";
import { useWorkspace } from "~/composables/useWorkspace";
import type { RecordDetail } from "~/types/api";
import { api } from "~/utils/api";
import { formatTime } from "~/utils/format";

const route = useRoute();
const { groupId, group, status } = useWorkspace();
const version = useQueryValue("version", positiveInteger);
const base = computed(
  () =>
    `groups/${groupId.value}/records/${encodeURIComponent(String(route.params.id))}`,
);
const { data, loading, error, refresh } = useApiData<RecordDetail>(
  () => `${base.value}${version.value ? `?version=${version.value}` : ""}`,
);
const tab = useQueryValue("tab", (value) =>
  value === "original" ? "original" : "note",
);
const isDraft = computed(() => data.value?.topic.mode === "auto");
const listLink = computed(
  () => `/${groupId.value}/records${isDraft.value ? "?view=drafts" : ""}`,
);
const editing = ref(false);
const showRegenerate = ref(false);
const { busy, run } = useAction();
const dialog = useDialog();
usePoll(async () => {
  if (
    !isDraft.value &&
    !editing.value &&
    data.value?.tasks.some(
      (task) => task.state === "running" || task.state === "pending",
    )
  ) {
    await refresh();
  }
});
const options = computed(
  () =>
    data.value?.versions.map((item) => ({
      label: `第 ${item.revision} 版 · ${formatTime(item.createdAt)}`,
      value: item.id,
    })) ?? [],
);
async function saved(): Promise<void> {
  editing.value = false;
  if (version.value === null) {
    await refresh();
  } else {
    version.value = null;
  }
}

function send(): void {
  const note = data.value!.note!;
  const path = `groups/${note.groupId}/records/${note.topicId}/send`;

  dialog.info({
    title: "发送纪要到群",
    content: `发送第 ${note.revision} 版到「${group.value?.name ?? groupId.value}」？`,
    positiveText: "发送到群",
    negativeText: "取消",
    onPositiveClick: () =>
      run(
        () =>
          api(path, {
            method: "POST",
            body: { noteId: note.id },
          }),
        "已安排发送",
      ),
  });
}
function remove(): void {
  const path = base.value;

  dialog.warning({
    title: isDraft.value ? "删除这份讨论草稿？" : "删除这篇纪要？",
    content: "该条目的全部版本和本地导出文件都会删除，原始群消息会保留。",
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      const result = await run(() => api(path, { method: "DELETE" }), "已删除");
      if (result) {
        await navigateTo(listLink.value);
      }

      return result;
    },
  });
}
</script>

<template>
  <NuxtLink class="muted back-link" :to="listLink">
    <NIcon :component="ArrowLeft" />
    {{ isDraft ? "返回讨论草稿" : "返回纪要列表" }}
  </NuxtLink>
  <PageHeading
    :description="group?.name ?? groupId"
    :title="data?.topic.title ?? '纪要'"
  >
    <NButton
      aria-label="刷新纪要"
      :disabled="editing"
      :loading
      @click="refresh"
    >
      <template #icon><NIcon :component="Refresh" /></template>
    </NButton>
    <NButton
      v-if="data?.note && !isDraft"
      :href="`/api/${base}/export?version=${data.note.id}`"
      tag="a"
    >
      <template #icon><NIcon :component="Download" /></template>
      下载 ZIP
    </NButton>
    <NButton
      v-if="data?.note && !isDraft"
      :disabled="!status?.running || !status.connected"
      :loading="busy"
      type="primary"
      @click="send"
    >
      <template #icon><NIcon :component="Send" /></template>
      发送到群
    </NButton>
    <NButton v-if="isDraft" type="primary" @click="showRegenerate = true">
      生成纪要
    </NButton>
    <template #toolbar>
      <ListToolbar v-if="data" class="reader-toolbar">
        <NSpace align="center">
          <NSelect
            v-if="!isDraft"
            class="version-select"
            :disabled="editing"
            :options
            placeholder="尚未生成纪要"
            :value="version ?? data.note?.id ?? null"
            @update:value="version = $event"
          />
          <RecordStatus :topic="data.topic" />
        </NSpace>
        <NSpace align="center" :wrap-item="false">
          <NButton
            v-if="!isDraft"
            :disabled="!data.note || editing"
            text
            @click="
              editing = true;
              tab = 'note';
            "
          >
            <template #icon><NIcon :component="Edit" /></template>
            编辑
          </NButton>
          <NButton v-if="!isDraft" text @click="showRegenerate = true">
            重新整理
          </NButton>
          <NTooltip>
            <template #trigger>
              <span class="delete-trigger">
                <NButton
                  aria-label="删除纪要"
                  :disabled="status?.running"
                  text
                  type="error"
                  @click="remove"
                >
                  <template #icon><NIcon :component="Trash" /></template>
                </NButton>
              </span>
            </template>
            暂停 AI 后可删除
          </NTooltip>
        </NSpace>
      </ListToolbar>
    </template>
  </PageHeading>
  <LoadState :error :loading="loading && !data" @retry="refresh">
    <template v-if="data">
      <NAlert
        v-for="task in data.tasks.filter(
          (item) =>
            !isDraft &&
            (item.state === 'running' ||
              item.state === 'pending' ||
              item.state === 'failed'),
        )"
        :key="task.id"
        :bordered="false"
        class="mb-15"
        :type="task.state === 'failed' ? 'error' : 'info'"
      >
        <strong>任务 #{{ task.id }}</strong>
        · {{ task.lastError || task.progress || "等待整理" }}
        <NuxtLink :to="`/${groupId}/tasks`">查看任务</NuxtLink>
      </NAlert>
      <NAlert v-if="isDraft" :bordered="false" class="mb-15" type="info">
        自动留存的讨论草稿，用于以后查阅和继续讨论。需要正式纪要时，点击“生成纪要”。
      </NAlert>
      <PageTabs v-model:value="tab">
        <NTabPane
          display-directive="show:lazy"
          name="note"
          :tab="isDraft ? '讨论概览' : '纪要正文'"
        >
          <template v-if="isDraft">
            <RecordReader>
              <p class="draft-description">
                {{ data.topic.description || "暂无讨论简介，可查看关联原文。" }}
              </p>
            </RecordReader>
            <details v-if="data.note" class="retained-draft">
              <summary>查看以前自动生成的内容（保留为草稿）</summary>
              <RecordReader>
                <MarkdownContent
                  :content="data.note.markdown"
                  :group-id
                  @transcript="tab = 'original'"
                />
              </RecordReader>
            </details>
          </template>
          <NoteEditor
            v-else-if="editing && data.note"
            :note="data.note"
            @cancel="editing = false"
            @saved="saved"
          />
          <RecordReader v-else-if="data.note">
            <MarkdownContent
              :content="data.note.markdown"
              :group-id
              @transcript="tab = 'original'"
            />
          </RecordReader>
          <AppPanel v-else>
            <EmptyState
              description="完成后会自动显示，进度和错误可在“后台任务”中查看。"
              title="尚未生成第一版纪要"
            >
              <NuxtLink :to="`/${groupId}/tasks`">
                <NButton>查看任务</NButton>
              </NuxtLink>
            </EmptyState>
          </AppPanel>
        </NTabPane>
        <NTabPane display-directive="show:lazy" name="original" tab="完整原文">
          <TranscriptView
            :key="isDraft ? data.topic.id : data.note?.id"
            :note="isDraft ? null : data.note"
            :topic="data.topic"
          />
        </NTabPane>
      </PageTabs>
    </template>
  </LoadState>
  <RegenerateDialog
    v-if="showRegenerate && data"
    :topic="data.topic"
    @close="showRegenerate = false"
    @saved="refresh"
  />
</template>

<style scoped>
.draft-description {
  white-space: pre-wrap;
}
.retained-draft {
  margin: 24px auto;
  max-width: 1080px;
}
.retained-draft summary {
  cursor: pointer;
  color: #798899;
  margin-bottom: 16px;
}

.muted {
  color: #798899;
}

.mb-15 {
  margin-bottom: 15px;
}

.reader-toolbar {
  justify-content: space-between;
  gap: 18px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 18px;
}

.version-select {
  width: 230px;
}

.delete-trigger {
  display: inline-flex;
}
</style>
