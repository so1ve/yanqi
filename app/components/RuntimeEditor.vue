<script setup lang="ts">
import type { Config } from "@yanqi/bot";

const model = defineModel<Config>({ required: true });
type NumericKey = {
  [K in keyof Config]: Config[K] extends number ? K : never;
}[keyof Config];
const fields: { key: NumericKey; label: string; min?: number }[] = [
  { key: "AI_TIMEOUT_MS", label: "普通请求超时（毫秒）" },
  { key: "AI_MAX_OUTPUT_TOKENS", label: "普通请求最大输出 token" },
  { key: "AI_THINKING_TIMEOUT_MS", label: "总结思考超时（毫秒）" },
  { key: "AI_THINKING_MAX_OUTPUT_TOKENS", label: "总结思考与正文总输出 token" },
  { key: "AI_INPUT_CHARS", label: "上下文字符预算", min: 4000 },
  { key: "AI_DAILY_CALL_LIMIT", label: "每日模型调用上限" },
  { key: "DETECT_INTERVAL_MS", label: "讨论识别等待时间（毫秒）" },
  { key: "DETECT_BATCH_SIZE", label: "每批讨论消息数" },
  { key: "TOPIC_IDLE_MS", label: "讨论空闲整理时间（毫秒）" },
  { key: "TOPIC_REOPEN_MS", label: "旧话题继续讨论的时间范围（毫秒）" },
  { key: "WORK_INTERVAL_MS", label: "后台轮询间隔（毫秒）" },
  { key: "MAX_ATTACHMENT_BYTES", label: "附件最大字节数" },
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
      <p>DeepSeek 总结提取与合并启用思考，普通对话优先快速调用工具。</p>
    </div>
    <div class="form-grid">
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
            { label: 'JSON Object', value: 'json_object' },
            { label: 'JSON Schema', value: 'json_schema' },
          ]"
        />
      </NFormItem>
      <NFormItem label="日志详细程度">
        <NSelect
          v-model:value="model.LOG_LEVEL"
          :options="[
            { label: 'Info · 任务和调用过程', value: 'info' },
            { label: 'Debug · 参数、结果及堆栈', value: 'debug' },
          ]"
        />
      </NFormItem>
      <NFormItem label="接收请求的 QQ 表情 ID">
        <NInput
          v-model:value="model.ACK_EMOJI_ID"
          placeholder="128051（鲸鱼）；留空关闭"
        />
      </NFormItem>
    </div>
  </section>
</template>
