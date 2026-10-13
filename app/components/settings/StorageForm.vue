<script setup lang="ts">
import type { Config } from "@yanqi/bot";
import { useDialog } from "naive-ui";
import { ref } from "vue";

import { useAction } from "~/composables/useAction";
import type { PurgeResult } from "~/types/api";
import { api } from "~/utils/api";

const props = defineProps<{ savedDays: number }>();
const draft = defineModel<Config>({ required: true });
const result = ref<PurgeResult | null>(null);
const dialog = useDialog();
const { busy, run } = useAction();

function purge(): void {
  dialog.warning({
    title: "清理过期历史",
    content: `将删除 ${props.savedDays} 天前未被纪要、记忆或待处理请求引用的消息及附件。此操作无法撤销。`,
    positiveText: "清理",
    negativeText: "取消",
    onPositiveClick: () =>
      run(async () => {
        result.value = await api("storage/purge", { method: "POST" });
      }, "清理完成"),
  });
}
</script>

<template>
  <NForm class="storage-form">
    <NFormItem label="历史保留天数">
      <NInputNumber
        v-model:value="draft.HISTORY_RETENTION_DAYS"
        :max="36500"
        :min="0"
        :precision="0"
        :show-button="false"
      />
    </NFormItem>
    <p>默认保留 30 天。填 0 关闭清理，修改后点击上方“保存并应用”。</p>
    <p>
      已启用的群会保存全部消息，包括未 @
      的消息和普通成员的发言。纪要及其历史版本、记忆引用的原文和附件长期保留。
    </p>
    <p>
      服务启动后及每小时清理一次，AI
      暂停时仍会执行。有任务正在读取的群暂缓清理；附件下载期间也会暂缓，避免删掉正在使用的文件。
    </p>
    <NButton :disabled="props.savedDays === 0" :loading="busy" @click="purge">
      按已保存设置立即清理
    </NButton>
    <NAlert
      v-if="result"
      :bordered="false"
      class="result"
      title="清理结果"
      type="success"
    >
      删除 {{ result.messages }} 条消息、{{ result.assets }} 条附件记录和
      {{ result.files }} 个文件，释放文件空间
      {{ (result.bytes / 1024 / 1024).toFixed(2) }} MiB。
      <template v-if="result.skippedGroups">
        {{ result.skippedGroups }} 个群因任务处理中而暂缓清理。
      </template>
    </NAlert>
    <p class="detail">
      消息内容无损压缩保存，相同附件共用文件。SQLite
      会复用删除后空出的页面，数据库文件不一定立即缩小。
    </p>
  </NForm>
</template>

<style scoped>
.storage-form {
  max-width: 760px;
}

p {
  color: #798899;
  margin-bottom: 16px;
}

.result {
  margin-top: 20px;
}

.detail {
  font-size: 12px;
  margin-top: 20px;
}
</style>
