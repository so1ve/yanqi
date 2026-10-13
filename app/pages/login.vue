<script setup lang="ts">
import { ref } from "vue";

import { definePageMeta, navigateTo } from "#imports";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { api } from "~/utils/api";

definePageMeta({ layout: false });
const { data, loading, error, refresh } = useApiData<{
  authenticated: boolean;
  setupRequired: boolean;
}>("session");
const password = ref("");
const setupCode = ref("");
const { busy, run } = useAction();
async function login(): Promise<void> {
  if (
    await run(() =>
      api("login", {
        method: "POST",
        body: { password: password.value, setupCode: setupCode.value },
      }),
    )
  ) {
    await navigateTo(data.value?.setupRequired ? "/settings" : "/");
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-intro">
      <div class="brand">
        <span class="brand-mark">栖</span>
        <strong>言栖</strong>
      </div>
      <div>
        <span class="eyebrow">QQ 群聊记录</span>
        <h1>
          保存群聊，
          <br />
          整理讨论。
        </h1>
        <p>
          查看消息和纪要，管理小栖。
          <br />
          所有记录保存在你的服务器上。
        </p>
      </div>
      <span class="login-caption">YANQI / 管理台</span>
    </section>
    <section class="login-form">
      <div class="login-form-inner">
        <h2>{{ data?.setupRequired ? "设置管理密码" : "登录管理台" }}</h2>
        <p class="muted">
          {{
            data?.setupRequired
              ? "填写安装码，并设置一个管理密码。"
              : "请输入管理密码。"
          }}
        </p>
        <LoadState :error :loading @retry="refresh">
          <NForm @submit.prevent="login">
            <NFormItem v-if="data?.setupRequired" label="安装码">
              <NInput
                v-model:value="setupCode"
                autocomplete="off"
                placeholder="言栖启动日志中的安装码"
              />
            </NFormItem>
            <NFormItem label="管理密码">
              <NInput
                v-model:value="password"
                :autocomplete="
                  data?.setupRequired ? 'new-password' : 'current-password'
                "
                :placeholder="
                  data?.setupRequired ? '至少 10 个字符' : '管理密码'
                "
                show-password-on="click"
                type="password"
              />
            </NFormItem>
            <NButton
              attr-type="submit"
              block
              :disabled="
                password.length < 10 || (data?.setupRequired && !setupCode)
              "
              :loading="busy"
              size="large"
              type="primary"
            >
              {{ data?.setupRequired ? "设置密码并登录" : "登录" }}
            </NButton>
          </NForm>
        </LoadState>
        <p v-if="data?.setupRequired" class="login-help">
          安装码可通过
          <code>docker compose logs yanqi</code>
          查看。
        </p>
      </div>
    </section>
  </main>
</template>
