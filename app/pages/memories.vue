<script setup lang="ts">
import { Plus, Search } from "@vicons/tabler";
import type { DataTableColumns } from "naive-ui";
import { NButton, useDialog } from "naive-ui";
import { h, ref, watch } from "vue";

import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Memory, Page } from "~/types/api";
import { api, formatTime } from "~/utils/api";

const { groupId, group } = useWorkspace();
const page = ref(1);
const query = ref("");
const searchQuery = ref("");
watch([groupId, searchQuery], () => {
  page.value = 1;
});
const { data, loading, error, refresh } = useApiData<Page<Memory>>(() =>
  groupId.value
    ? `groups/${groupId.value}/memories?page=${page.value}&q=${encodeURIComponent(searchQuery.value)}`
    : "",
);
const show = ref(false);
const existing = ref(false);
const form = ref({ userId: "", key: "", content: "" });
const { busy, run } = useAction();
const dialog = useDialog();
function edit(row?: Memory): void {
  existing.value = Boolean(row);
  form.value = row
    ? { userId: row.userId, key: row.key, content: row.content }
    : { userId: "", key: "", content: "" };
  show.value = true;
}
async function save(): Promise<void> {
  if (
    await run(async () => {
      await api(`groups/${groupId.value}/memories`, {
        method: "PUT",
        body: form.value,
      });
      await refresh();
    }, "记忆已保存")
  ) {
    show.value = false;
  }
}
function remove(row: Memory): void {
  dialog.warning({
    title: "删除这条记忆？",
    content: row.key,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: () =>
      run(async () => {
        await api(`groups/${groupId.value}/memories`, {
          method: "DELETE",
          body: { userId: row.userId, key: row.key },
        });
        await refresh();
      }, "已删除"),
  });
}
const columns: DataTableColumns<Memory> = [
  { title: "成员", key: "userId", width: 135 },
  {
    title: "记忆",
    key: "key",
    minWidth: 300,
    render: (row) =>
      h("div", [
        h("strong", row.key),
        h(
          "p",
          {
            class: "cell-sub",
            style: "white-space: pre-wrap; font-size: 13px; color: #68788b",
          },
          row.content,
        ),
      ]),
  },
  {
    title: "更新",
    key: "updatedAt",
    width: 165,
    render: (row) =>
      h("div", [
        formatTime(row.updatedAt),
        h(
          "p",
          { class: "cell-sub" },
          row.sourceMessageId === null
            ? "管理台编辑"
            : `来自消息 m${row.sourceMessageId}`,
        ),
      ]),
  },
  {
    title: "操作",
    key: "actions",
    width: 135,
    render: (row) =>
      h("div", { class: "row-actions" }, [
        h(
          NButton,
          { size: "small", onClick: () => edit(row) },
          { default: () => "编辑" },
        ),
        h(
          NButton,
          {
            size: "small",
            type: "error",
            quaternary: true,
            onClick: () => remove(row),
          },
          { default: () => "删除" },
        ),
      ]),
  },
];
</script>

<template>
  <PageHeading
    :description="`${group?.name ?? '选择一个群'} · 按成员保存的偏好和约定`"
    title="记忆"
  >
    <NButton :disabled="!groupId" type="primary" @click="edit()">
      <template #icon><NIcon :component="Plus" /></template>
      添加记忆
    </NButton>
  </PageHeading>
  <form class="toolbar" @submit.prevent="searchQuery = query">
    <NInput
      v-model:value="query"
      class="search"
      clearable
      placeholder="搜索内容、名称或 QQ 号"
    >
      <template #prefix><NIcon :component="Search" /></template>
    </NInput>
    <NButton attr-type="submit">搜索</NButton>
  </form>
  <LoadState
    description="小栖可以记住成员的偏好，也可以在这里直接补充或修改。"
    :empty="!data?.items.length"
    :error
    :loading="loading && !data"
    title="还没有保存的记忆"
    @retry="refresh"
  >
    <div class="panel">
      <NDataTable
        :bordered="false"
        :columns
        :data="data?.items ?? []"
        :scroll-x="700"
      />
    </div>
    <div class="pagination">
      <span>共 {{ data?.total }} 条</span>
      <NPagination
        v-model:page="page"
        :item-count="data?.total ?? 0"
        :page-size="30"
      />
    </div>
  </LoadState>
  <NModal
    v-model:show="show"
    class="modal-medium"
    preset="card"
    :title="existing ? '编辑记忆' : '添加记忆'"
  >
    <NForm @submit.prevent="save">
      <NFormItem label="成员 QQ 号">
        <NInput
          v-model:value="form.userId"
          :disabled="existing"
          placeholder="这条记忆属于谁"
        />
      </NFormItem>
      <NFormItem label="名称">
        <NInput
          v-model:value="form.key"
          :disabled="existing"
          placeholder="例如：纪要偏好"
        />
      </NFormItem>
      <NFormItem label="内容">
        <NInput
          v-model:value="form.content"
          :autosize="{ minRows: 4, maxRows: 12 }"
          type="textarea"
        />
      </NFormItem>
      <NSpace justify="end">
        <NButton @click="show = false">取消</NButton>
        <NButton
          attr-type="submit"
          :disabled="!/^\d+$/.test(form.userId) || !form.key || !form.content"
          :loading="busy"
          type="primary"
        >
          保存
        </NButton>
      </NSpace>
    </NForm>
  </NModal>
</template>
