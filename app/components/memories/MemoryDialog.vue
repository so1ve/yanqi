<script setup lang="ts">
import { ref } from "vue";

import { useAction } from "~/composables/useAction";
import type { Memory } from "~/types/api";
import { api } from "~/utils/api";

const emit = defineEmits<{ close: []; saved: [] }>();
const props = defineProps<{
  groupId: string;
  scope: Memory["scope"];
  memory?: Memory;
}>();
const { busy, run } = useAction();
const form = ref({
  scope: props.memory?.scope ?? props.scope,
  ownerId:
    props.memory?.ownerId ?? (props.scope === "group" ? props.groupId : ""),
  key: props.memory?.key ?? "",
  content: props.memory?.content ?? "",
});

async function save(): Promise<void> {
  if (
    await run(
      () =>
        api("memories", {
          method: "PUT",
          body: form.value,
        }),
      "记忆已保存",
    )
  ) {
    emit("saved");
    emit("close");
  }
}
</script>

<template>
  <AppDialog
    :title="props.memory ? '编辑记忆' : '添加记忆'"
    @close="emit('close')"
  >
    <NForm @submit.prevent="save">
      <NFormItem label="适用范围">
        {{ form.scope === "group" ? "群共享" : "个人偏好" }}
      </NFormItem>
      <p class="scope-help">
        {{
          form.scope === "group"
            ? "只在当前群生效，例如少发言、群内约定或共同项目背景。"
            : "跟随这个 QQ 账号跨群生效，例如称呼、回复长度或个人输出偏好。"
        }}
      </p>
      <NFormItem v-if="form.scope === 'user'" label="成员 QQ 号">
        <NInput
          v-model:value="form.ownerId"
          :disabled="!!props.memory"
          placeholder="填写成员的 QQ 号"
        />
      </NFormItem>
      <NFormItem label="名称">
        <NInput
          v-model:value="form.key"
          :disabled="!!props.memory"
          :maxlength="60"
          placeholder="例如：纪要偏好"
        />
      </NFormItem>
      <NFormItem label="内容">
        <NInput
          v-model:value="form.content"
          :autosize="{ minRows: 4, maxRows: 12 }"
          :maxlength="500"
          show-count
          type="textarea"
        />
      </NFormItem>
      <NSpace justify="end">
        <NButton @click="emit('close')">取消</NButton>
        <NButton
          attr-type="submit"
          :disabled="
            !/^\d+$/.test(form.ownerId) ||
            !form.key.trim() ||
            !form.content.trim()
          "
          :loading="busy"
          type="primary"
        >
          保存
        </NButton>
      </NSpace>
    </NForm>
  </AppDialog>
</template>

<style scoped>
.scope-help {
  margin: -4px 0 20px;
  color: #68788b;
  font-size: 13px;
}
</style>
