<script setup lang="ts">
import { ref } from "vue";

import { useAction } from "~/composables/useAction";
import type { Memory } from "~/types/api";
import { api } from "~/utils/api";

const emit = defineEmits<{ close: []; saved: [] }>();
const props = defineProps<{ groupId: string; memory?: Memory }>();
const { busy, run } = useAction();
const form = ref({
  userId: props.memory?.userId ?? "",
  key: props.memory?.key ?? "",
  content: props.memory?.content ?? "",
});

async function save(): Promise<void> {
  if (
    await run(
      () =>
        api(`groups/${props.groupId}/memories`, {
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
      <NFormItem label="成员 QQ 号">
        <NInput
          v-model:value="form.userId"
          :disabled="!!props.memory"
          placeholder="填写成员的 QQ 号"
        />
      </NFormItem>
      <NFormItem label="名称">
        <NInput
          v-model:value="form.key"
          :disabled="!!props.memory"
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
        <NButton @click="emit('close')">取消</NButton>
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
  </AppDialog>
</template>
