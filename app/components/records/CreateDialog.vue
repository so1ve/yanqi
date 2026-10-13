<script setup lang="ts">
import type { Topic } from "@yanqi/bot";
import { ref } from "vue";

import { navigateTo } from "#imports";
import { useAction } from "~/composables/useAction";
import { api } from "~/utils/api";

const emit = defineEmits<{ close: [] }>();
const props = defineProps<{ groupId: string }>();
const title = ref("");
const focus = ref("");
const scope = ref<"all" | "range">("all");
const range = ref<[number, number] | null>(null);
const { busy, run } = useAction();
async function create(): Promise<void> {
  await run(async () => {
    const result = await api<{ topic: Topic }>(
      `groups/${props.groupId}/records`,
      {
        method: "POST",
        body: {
          title: title.value,
          focus: focus.value,
          ...(scope.value === "range" && range.value
            ? { from: range.value[0], to: range.value[1] }
            : {}),
        },
      },
    );
    emit("close");
    await navigateTo(`/records/${result.topic.id}?group=${props.groupId}`);
  }, "已安排整理");
}
</script>

<template>
  <AppDialog title="从原始消息创建纪要" :width="580" @close="emit('close')">
    <NForm @submit.prevent="create">
      <NFormItem label="标题">
        <NInput v-model:value="title" placeholder="例如：部署方案讨论" />
      </NFormItem>
      <NFormItem label="整理要求">
        <NInput
          v-model:value="focus"
          :autosize="{ minRows: 3, maxRows: 8 }"
          placeholder="例如：整理所有部署建议及其理由。留空则整理范围内的全部内容。"
          type="textarea"
        />
      </NFormItem>
      <NFormItem label="原文范围">
        <NRadioGroup v-model:value="scope">
          <NSpace>
            <NRadio value="all">全部已保存消息</NRadio>
            <NRadio value="range">指定时间</NRadio>
          </NSpace>
        </NRadioGroup>
      </NFormItem>
      <NFormItem v-if="scope === 'range'" label="开始与结束时间">
        <NDatePicker
          v-model:value="range"
          class="w-full"
          type="datetimerange"
        />
      </NFormItem>
      <p class="form-help">
        纪要只保存到本地。需要发到群里时，请在完成后点击“发送到群”。AI
        暂停时，任务会等待恢复。
      </p>
      <NSpace class="mt-24" justify="end">
        <NButton @click="emit('close')">取消</NButton>
        <NButton
          attr-type="submit"
          :disabled="!title.trim() || (scope === 'range' && !range)"
          :loading="busy"
          type="primary"
        >
          开始整理
        </NButton>
      </NSpace>
    </NForm>
  </AppDialog>
</template>

<style scoped>
.form-help {
  font-size: 12px;
  color: #8a97a7;
  margin-top: 7px;
}

.mt-24 {
  margin-top: 24px;
}

.w-full {
  width: 100%;
}
</style>
