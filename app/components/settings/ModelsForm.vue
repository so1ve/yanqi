<script setup lang="ts">
import type { Config } from "@yanqi/bot";

const draft = defineModel<Config>({ required: true });

function enable(
  kind: "AI_VISION_MODEL" | "AI_AUDIO_MODEL",
  value: boolean,
): void {
  draft.value[kind] = value ? { baseURL: "", apiKey: "", model: "" } : null;
}
</script>

<template>
  <NForm>
    <ModelEditor
      v-model="draft.AI_MODEL"
      description="理解请求、整理纪要和回复群消息。"
      title="主模型"
    />
    <div class="model-card-head">
      <div>
        <h3>图片理解</h3>
        <p class="form-help">
          识别图片中的文字、代码和画面。关闭后仍保存原图。
        </p>
      </div>
      <NSwitch
        :value="draft.AI_VISION_MODEL !== null"
        @update:value="enable('AI_VISION_MODEL', $event)"
      />
    </div>
    <ModelEditor
      v-if="draft.AI_VISION_MODEL"
      v-model="draft.AI_VISION_MODEL"
      description="服务需要支持 OpenAI 兼容的图片输入。"
      title="视觉模型"
    />
    <div class="model-card-head">
      <div>
        <h3>语音转写</h3>
        <p class="form-help">把语音转成文字。关闭后仍保存原始音频。</p>
      </div>
      <NSwitch
        :value="draft.AI_AUDIO_MODEL !== null"
        @update:value="enable('AI_AUDIO_MODEL', $event)"
      />
    </div>
    <ModelEditor
      v-if="draft.AI_AUDIO_MODEL"
      v-model="draft.AI_AUDIO_MODEL"
      description="服务需要支持 /audio/transcriptions。"
      title="语音模型"
    />
  </NForm>
</template>

<style scoped>
.form-help {
  font-size: 12px;
  color: #8a97a7;
  margin-top: 7px;
}

.model-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
</style>
