<script setup lang="ts">
import type { Note } from "@yanqi/bot";
import { ref } from "vue";

import { useAction } from "~/composables/useAction";
import { api } from "~/utils/api";

const emit = defineEmits<{ cancel: []; saved: [] }>();
const props = defineProps<{ note: Note }>();
const note = props.note;
const markdown = ref(note.markdown);
const { busy, run } = useAction();

async function save(): Promise<void> {
  if (
    await run(
      () =>
        api(`groups/${note.groupId}/records/${note.topicId}/content`, {
          method: "PUT",
          body: { noteId: note.id, markdown: markdown.value },
        }),
      "已保存为新版本",
    )
  ) {
    emit("saved");
  }
}
</script>

<template>
  <div class="panel panel-body">
    <NInput
      v-model:value="markdown"
      :autosize="{ minRows: 20, maxRows: 45 }"
      placeholder="Markdown 正文"
      type="textarea"
    />
    <NSpace class="mt-18" justify="end">
      <NButton :disabled="busy" @click="emit('cancel')">取消</NButton>
      <NButton
        :disabled="!markdown.trim()"
        :loading="busy"
        type="primary"
        @click="save"
      >
        保存为新版本
      </NButton>
    </NSpace>
  </div>
</template>
