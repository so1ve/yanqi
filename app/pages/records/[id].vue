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
import { computed, ref, watch } from "vue";

import { navigateTo, useRoute } from "#imports";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { usePoll } from "~/composables/usePoll";
import { useWorkspace } from "~/composables/useWorkspace";
import type { RecordDetail } from "~/types/api";
import { api, formatTime } from "~/utils/api";

const route = useRoute();
const { groupId, group, status } = useWorkspace();
if (typeof route.query.group === "string" && /^\d+$/.test(route.query.group)) {
  groupId.value = route.query.group;
}
const version = ref<number | null>(null);
const base = computed(
  () =>
    `groups/${groupId.value}/records/${encodeURIComponent(String(route.params.id))}`,
);
const { data, loading, error, refresh } = useApiData<RecordDetail>(() =>
  groupId.value
    ? `${base.value}${version.value ? `?version=${version.value}` : ""}`
    : "",
);
const tab = ref("note");
const editing = ref(false);
const markdown = ref("");
const focus = ref("");
const showRegenerate = ref(false);
const {
  data: original,
  error: originalError,
  loading: originalLoading,
  refresh: refreshOriginal,
} = useApiData<string>(() =>
  tab.value === "original" && data.value?.note
    ? `${base.value}/transcript?version=${data.value.note.id}`
    : "",
);
const { busy, run } = useAction();
const dialog = useDialog();
watch(data, (value) => {
  if (value && !editing.value) {
    markdown.value = value.note?.markdown ?? "";
    focus.value = value.topic.focus;
  }
});
usePoll(async () => {
  if (
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
async function save(): Promise<void> {
  if (!data.value?.note) {
    return;
  }
  if (
    await run(
      () =>
        api(`${base.value}/content`, {
          method: "PUT",
          body: { noteId: data.value!.note!.id, markdown: markdown.value },
        }),
      "已保存为新版本",
    )
  ) {
    editing.value = false;
    version.value = null;
    await refresh();
  }
}
function send(): void {
  dialog.info({
    title: "发送纪要到群",
    content: `发送第 ${data.value!.note!.revision} 版到「${group.value?.name ?? groupId.value}」？`,
    positiveText: "发送到群",
    negativeText: "取消",
    onPositiveClick: () =>
      run(
        () =>
          api(`${base.value}/send`, {
            method: "POST",
            body: { noteId: data.value!.note!.id },
          }),
        "已安排发送",
      ),
  });
}
async function regenerate(): Promise<void> {
  if (
    await run(
      () =>
        api(`${base.value}/summarize`, {
          method: "POST",
          body: { focus: focus.value },
        }),
      "已安排重新整理",
    )
  ) {
    showRegenerate.value = false;
    await refresh();
  }
}
function remove(): void {
  dialog.warning({
    title: "删除这篇纪要？",
    content: "纪要的全部版本和本地导出文件都会删除，原始群消息会保留。",
    positiveText: "删除纪要",
    negativeText: "取消",
    onPositiveClick: async () => {
      const result = await run(
        () => api(base.value, { method: "DELETE" }),
        "纪要已删除",
      );
      if (result) {
        await navigateTo("/records");
      }

      return result;
    },
  });
}
function download(): void {
  if (!data.value?.note) {
    return;
  }
  const url = URL.createObjectURL(
    new Blob([data.value.note.markdown], {
      type: "text/markdown;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${data.value.topic.title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <NuxtLink class="muted back-link" to="/records">
    <NIcon :component="ArrowLeft" />
    返回纪要列表
  </NuxtLink>
  <PageHeading
    :description="group?.name ?? groupId"
    :title="data?.topic.title ?? '纪要'"
  >
    <NButton aria-label="刷新纪要" :loading @click="refresh">
      <template #icon><NIcon :component="Refresh" /></template>
    </NButton>
    <NButton v-if="data?.note" @click="download">
      <template #icon><NIcon :component="Download" /></template>
      导出
    </NButton>
    <NButton
      v-if="data?.note"
      :disabled="!status?.running || !status.connected"
      :loading="busy"
      type="primary"
      @click="send"
    >
      <template #icon><NIcon :component="Send" /></template>
      发送到群
    </NButton>
  </PageHeading>
  <LoadState :error :loading="loading && !data" @retry="refresh">
    <template v-if="data">
      <div class="reader-toolbar">
        <NSpace align="center">
          <NSelect
            class="version-select"
            :disabled="editing"
            :options
            placeholder="尚未生成纪要"
            :value="version ?? data.note?.id ?? null"
            @update:value="version = $event"
          />
          <StateTag :state="data.topic.state" />
        </NSpace>
        <NSpace>
          <NButton
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
          <NButton text @click="showRegenerate = true">重新整理</NButton>
          <NTooltip>
            <template #trigger>
              <span>
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
            暂停 AI 后可删除纪要
          </NTooltip>
        </NSpace>
      </div>
      <NAlert
        v-for="task in data.tasks.filter(
          (item) =>
            item.state === 'running' ||
            item.state === 'pending' ||
            item.state === 'failed',
        )"
        :key="task.id"
        :bordered="false"
        class="mb-15"
        :type="task.state === 'failed' ? 'error' : 'info'"
      >
        <strong>任务 #{{ task.id }}</strong>
        · {{ task.lastError || task.progress || "等待整理" }}
        <NuxtLink to="/tasks">查看任务</NuxtLink>
      </NAlert>
      <NTabs v-model:value="tab" animated type="line">
        <NTabPane name="note" tab="纪要正文">
          <div v-if="editing" class="panel panel-body">
            <NInput
              v-model:value="markdown"
              :autosize="{ minRows: 20, maxRows: 45 }"
              placeholder="Markdown 正文"
              type="textarea"
            />
            <NSpace class="mt-18" justify="end">
              <NButton
                @click="
                  editing = false;
                  markdown = data.note?.markdown ?? '';
                "
              >
                取消
              </NButton>
              <NButton :loading="busy" type="primary" @click="save">
                保存为新版本
              </NButton>
            </NSpace>
          </div>
          <article v-else-if="data.note" class="reader">
            <MarkdownContent
              :content="data.note.markdown"
              :group-id
              @transcript="tab = 'original'"
            />
          </article>
          <div v-else class="panel empty-state">
            <h3>尚未生成第一版纪要</h3>
            <p>完成后会自动显示，进度和错误可在“后台任务”中查看。</p>
            <NuxtLink to="/tasks"><NButton>查看任务</NButton></NuxtLink>
          </div>
        </NTabPane>
        <NTabPane :disabled="!data.note" name="original" tab="完整原文">
          <LoadState
            :error="originalError"
            :loading="originalLoading"
            @retry="refreshOriginal"
          >
            <article class="reader">
              <div class="transcript">{{ original }}</div>
            </article>
          </LoadState>
        </NTabPane>
      </NTabs>
    </template>
  </LoadState>
  <NModal
    v-model:show="showRegenerate"
    class="modal-medium"
    preset="card"
    title="重新整理这篇纪要"
  >
    <p class="muted mb-20">
      按下方要求重新整理原文，保存为新版本。完成后不会自动发到群里。
    </p>
    <NInput
      v-model:value="focus"
      :autosize="{ minRows: 5, maxRows: 12 }"
      placeholder="整理要求"
      type="textarea"
    />
    <NSpace class="mt-24" justify="end">
      <NButton @click="showRegenerate = false">取消</NButton>
      <NButton :loading="busy" type="primary" @click="regenerate">
        开始整理
      </NButton>
    </NSpace>
  </NModal>
</template>
