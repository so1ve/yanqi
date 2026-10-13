<script setup lang="ts">
import type { Config } from "@yanqi/bot";

const model = defineModel<Config>({ required: true });
type NumericKey = {
  [K in keyof Config]: Config[K] extends number ? K : never;
}[keyof Config];
const fields: { key: NumericKey; label: string; min?: number }[] = [
  { key: "AI_TIMEOUT_MS", label: "普通请求超时（毫秒）" },
  { key: "AI_MAX_OUTPUT_TOKENS", label: "普通请求输出上限（token）" },
  { key: "AI_THINKING_TIMEOUT_MS", label: "思考请求超时（毫秒）" },
  { key: "AI_THINKING_MAX_OUTPUT_TOKENS", label: "思考请求输出上限（token）" },
  { key: "AI_INPUT_CHARS", label: "AI 输入预算（字符）", min: 4000 },
  { key: "AI_DAILY_CALL_LIMIT", label: "每日模型调用上限" },
  { key: "DETECT_INTERVAL_MS", label: "每批消息最长收集时间（毫秒）" },
  { key: "DETECT_BATCH_SIZE", label: "每批识别的消息数" },
  { key: "TOPIC_IDLE_MS", label: "讨论暂停多久后整理（毫秒）" },
  { key: "TOPIC_REOPEN_MS", label: "自动识别时回看旧话题的时间范围（毫秒）" },
  { key: "WORK_INTERVAL_MS", label: "后台轮询间隔（毫秒）" },
  { key: "MAX_ATTACHMENT_BYTES", label: "附件大小上限（字节）" },
  { key: "LOG_DETAIL_CHARS", label: "日志详情最大字符数" },
];
function update(key: NumericKey, value: number | null): void {
  if (value !== null) {
    model.value[key] = value;
  }
}
</script>

<template>
  <section class="settings-section">
    <div class="section-title">
      <h2>运行参数</h2>
      <p>
        使用 DeepSeek
        官方服务时，整理和合并纪要会启用思考。输出上限包含思考内容、正文和工具参数。
      </p>
    </div>
    <FormGrid>
      <NFormItem v-for="field in fields" :key="field.key" :label="field.label">
        <NInputNumber
          class="w-full"
          :min="field.min ?? 1"
          :precision="0"
          :value="model[field.key]"
          @update:value="update(field.key, $event)"
        />
      </NFormItem>
      <NFormItem label="JSON 输出模式">
        <NSelect
          v-model:value="model.AI_RESPONSE_FORMAT"
          :options="[
            { label: 'JSON 对象（json_object）', value: 'json_object' },
            { label: 'JSON Schema（json_schema）', value: 'json_schema' },
          ]"
        />
      </NFormItem>
      <NFormItem label="日志详细程度">
        <NSelect
          v-model:value="model.LOG_LEVEL"
          :options="[
            { label: '常规（info）：任务进度和调用结果', value: 'info' },
            {
              label: '调试（debug）：增加参数、结果片段和错误堆栈',
              value: 'debug',
            },
          ]"
        />
      </NFormItem>
      <NFormItem label="收到请求后的回应表情 ID">
        <NInput
          v-model:value="model.ACK_EMOJI_ID"
          placeholder="128051 为鲸鱼，留空关闭"
        />
      </NFormItem>
    </FormGrid>
  </section>
</template>

<style scoped>
.w-full {
  width: 100%;
}

.section-title {
  margin-bottom: 18px;
}

.section-title p {
  color: #8592a2;
  font-size: 12px;
  margin-top: 6px;
}

.settings-section {
  max-width: 1050px;
  margin-bottom: 28px;
}

.settings-section + .settings-section {
  border-top: 1px solid #e8edf2;
  padding-top: 28px;
}
</style>
