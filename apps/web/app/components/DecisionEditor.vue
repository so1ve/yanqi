<script setup lang="ts">
import type { Config } from "@yanqi/bot";

defineProps<{ storedKey?: boolean }>();
const model = defineModel<Config>({ required: true });
const providers: {
  id: Config["DECISION_PROVIDER"];
  name: string;
  description: string;
}[] = [
  { id: "llm", name: "主模型", description: "直接使用主模型识别记录请求" },
  { id: "clef", name: "Clef", description: "Cloudflare Workers AI 的决策模型" },
  { id: "openai", name: "OpenAI", description: "独立的 Decisions 接口" },
  { id: "vercel", name: "Vercel", description: "AI Gateway 的 Decisions 接口" },
  { id: "jev", name: "JEV", description: "提供 JEV 协议的服务" },
];
function choose(provider: Config["DECISION_PROVIDER"]): void {
  model.value.DECISION_PROVIDER = provider;
}
</script>

<template>
  <section class="settings-section">
    <div class="section-title">
      <h2>记录请求识别</h2>
      <p>
        判断未 @ 的消息是否与记录事务有关，通过后交给主 Agent。@ 请求直接通过。
      </p>
    </div>
    <div aria-label="决策提供商" class="provider-grid" role="group">
      <button
        v-for="provider in providers"
        :key="provider.id"
        :aria-pressed="model.DECISION_PROVIDER === provider.id"
        class="provider-choice"
        :class="{ selected: model.DECISION_PROVIDER === provider.id }"
        @click="choose(provider.id)"
      >
        <strong>{{ provider.name }}</strong>
        <span>{{ provider.description }}</span>
      </button>
    </div>
    <div v-if="model.DECISION_PROVIDER !== 'llm'" class="model-card">
      <div class="form-grid">
        <NFormItem
          class="full-width"
          :label="
            ['jev', 'clef'].includes(model.DECISION_PROVIDER)
              ? '完整 POST 地址'
              : 'API Base URL'
          "
        >
          <NInput v-model:value="model.DECISION_URL" placeholder="https://…" />
        </NFormItem>
        <NFormItem label="模型名称">
          <NInput
            v-model:value="model.DECISION_MODEL"
            :placeholder="
              model.DECISION_PROVIDER === 'clef' ? 'clef' : '模型 ID'
            "
          />
        </NFormItem>
        <NFormItem label="API Key">
          <NInput
            v-model:value="model.DECISION_API_KEY"
            autocomplete="new-password"
            :placeholder="
              storedKey ? '已保存；留空保留' : 'API Key / Workers AI Token'
            "
            show-password-on="click"
            type="password"
          />
        </NFormItem>
      </div>
      <p v-if="model.DECISION_PROVIDER === 'clef'" class="form-help">
        地址：
        <code>
          https://api.cloudflare.com/client/v4/accounts/你的账户ID/ai/run/@cf/cloudflare/clef
        </code>
        <br />
        模型填
        <code>clef</code>
        ；密钥填有 Workers AI 权限的 API Token 原文，不加 Bearer。
      </p>
      <p class="form-help">
        独立服务调用失败时会报告错误，不会自动回退到主模型。
      </p>
    </div>
    <NSpace align="center">
      <NSwitch v-model:value="model.AUTO_REPLY" />
      <span>识别未 @ 的记录请求</span>
    </NSpace>
  </section>
</template>
