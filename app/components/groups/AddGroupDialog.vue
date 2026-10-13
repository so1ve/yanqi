<script setup lang="ts">
import { ref } from "vue";

import { useAction } from "~/composables/useAction";
import { useWorkspace } from "~/composables/useWorkspace";
import { api } from "~/utils/api";

const emit = defineEmits<{ close: [] }>();
const newId = ref("");
const workspace = useWorkspace();
const { busy, run } = useAction();

async function add(): Promise<void> {
  if (
    await run(async () => {
      await api(`groups/${newId.value}/settings`, {
        method: "PUT",
        body: { enabled: true },
      });
      await workspace.refresh();
    }, "群已添加")
  ) {
    emit("close");
  }
}
</script>

<template>
  <NModal
    class="modal-narrow"
    preset="card"
    show
    title="添加记录群"
    @update:show="emit('close')"
  >
    <NForm @submit.prevent="add">
      <NFormItem label="群号">
        <NInput v-model:value="newId" placeholder="机器人已加入的 QQ 群" />
      </NFormItem>
      <p class="form-help">请先让机器人 QQ 账号加入该群，再添加群号。</p>
      <NSpace class="mt-20" justify="end">
        <NButton @click="emit('close')">取消</NButton>
        <NButton
          attr-type="submit"
          :disabled="!/^\d+$/.test(newId)"
          :loading="busy"
          type="primary"
        >
          添加
        </NButton>
      </NSpace>
    </NForm>
  </NModal>
</template>
