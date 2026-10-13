<script setup lang="ts">
import type { Config } from "@yanqi/bot";

const model = defineModel<Config>({ required: true });
const providers: {
  id: Config["DECISION_PROVIDER"];
  name: string;
  description: string;
}[] = [
  { id: "llm", name: "主模型", description: "使用已配置的主模型" },
  { id: "clef", name: "Clef", description: "Cloudflare Workers AI 的决策模型" },
  { id: "openai", name: "OpenAI", description: "Decisions 接口" },
  { id: "vercel", name: "Vercel", description: "AI Gateway 的 Decisions 接口" },
  { id: "jev", name: "JEV", description: "兼容 JEV 协议的服务" },
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
        识别未 @ 小栖的记录请求，交给主模型处理。@
        小栖时直接处理。两种方式都需要交互权限。
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
      <FormGrid>
        <NFormItem
          class="full-width"
          :label="
            ['jev', 'clef'].includes(model.DECISION_PROVIDER)
              ? '完整接口地址（POST）'
              : '服务地址（Base URL）'
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
            autocomplete="off"
            placeholder="API Key / Workers AI Token"
          />
        </NFormItem>
      </FormGrid>
      <p v-if="model.DECISION_PROVIDER === 'clef'" class="form-help">
        地址：
        <code>
          https://api.cloudflare.com/client/v4/accounts/你的账户ID/ai/run/@cf/cloudflare/clef
        </code>
        <br />
        模型名称填
        <code>clef</code>
        ，API Key 填有 Workers AI 权限的 Token，不加 Bearer 前缀。
      </p>
      <p class="form-help">
        此服务调用失败时，请查看任务错误。小栖不会改用主模型重试。
      </p>
    </div>
    <NSpace align="center">
      <NSwitch v-model:value="model.AUTO_REPLY" />
      <span>识别未 @ 的记录请求</span>
    </NSpace>
  </section>
</template>

<style scoped>
.form-help {
  font-size: 12px;
  color: #8a97a7;
  margin-top: 7px;
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

.model-card {
  border: 1px solid #e2e8ef;
  background: #fff;
  border-radius: 8px;
  padding: 22px;
  margin-bottom: 16px;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.provider-choice {
  display: block;
  border: 1px solid #dfe6ed;
  background: #fff;
  border-radius: 7px;
  color: #526376;
  padding: 18px 14px;
  text-align: left;
}

.provider-choice.selected {
  border-color: #277f80;
  box-shadow: 0 0 0 1px #277f80;
  background: #f3f9f9;
}

.provider-choice strong {
  display: block;
  font-size: 14px;
  margin-bottom: 7px;
  color: #243348;
}

.provider-choice span {
  font-size: 11px;
  line-height: 1.6;
  display: block;
}

@media (max-width: 1100px) {
  .provider-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 760px) {
  .provider-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
