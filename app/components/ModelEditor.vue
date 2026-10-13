<script setup lang="ts">
import type { ModelConfig } from "@yanqi/bot";

defineProps<{ title: string; description: string }>();
const model = defineModel<ModelConfig>({ required: true });
</script>

<template>
  <section class="model-card">
    <div class="model-card-head">
      <div>
        <h3>{{ title }}</h3>
        <p class="form-help">{{ description }}</p>
      </div>
      <NTag :bordered="false" size="small">OpenAI 兼容接口</NTag>
    </div>
    <div class="form-grid">
      <NFormItem label="服务地址">
        <NInput
          v-model:value="model.baseURL"
          placeholder="https://api.example.com/v1"
        />
      </NFormItem>
      <NFormItem label="模型名称">
        <NInput v-model:value="model.model" placeholder="服务商提供的模型 ID" />
      </NFormItem>
      <NFormItem class="full-width" label="API Key">
        <div class="w-full">
          <NInput
            v-model:value="model.apiKey"
            autocomplete="off"
            placeholder="填入此服务的 API Key"
          />
          <p class="form-help">每个模型都可以使用不同的服务和密钥。</p>
        </div>
      </NFormItem>
    </div>
  </section>
</template>
