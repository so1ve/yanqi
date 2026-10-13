<script setup lang="ts">
import { ref } from "vue";

import { definePageMeta, navigateTo, useRoute } from "#imports";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { api } from "~/utils/api";

definePageMeta({ layout: false });
const route = useRoute();
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
    const redirect = route.query.redirect;
    const destination =
      typeof redirect === "string" &&
      redirect.startsWith("/") &&
      !redirect.startsWith("//") &&
      !redirect.includes("\\")
        ? redirect
        : "/";
    await navigateTo(data.value?.setupRequired ? "/settings" : destination, {
      replace: true,
    });
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-intro">
      <AppBrand class="login-brand" />
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

<style scoped>
.muted {
  color: #798899;
}

.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1.15fr 1fr;
}

.login-intro {
  background: #e8f0f1;
  padding: 56px 10%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 100vh;
}

.login-intro h1 {
  font-size: clamp(30px, 3vw, 42px);
  line-height: 1.7;
  margin: 20px 0;
  color: #244b51;
  letter-spacing: 0;
}

.login-intro p {
  color: #6d8b90;
  line-height: 2;
}

.eyebrow {
  font-size: 12px;
  color: #7a999d;
  letter-spacing: 2px;
}

.login-caption {
  color: #9bb0b3;
  font-size: 11px;
  letter-spacing: 2px;
}

.login-form {
  background: #fcfdff;
  display: grid;
  place-items: center;
  padding: 36px;
}

.login-form-inner {
  width: min(100%, 350px);
}

.login-form h2 {
  font-size: 25px;
  margin-bottom: 10px;
}

.login-form .muted {
  font-size: 13px;
  margin-bottom: 30px;
}

.login-help {
  margin-top: 24px;
  color: #9aa5b3;
  font-size: 11px;
}

@media (max-width: 760px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-intro {
    min-height: auto;
    gap: 40px;
    padding: 30px;
  }

  .login-intro h1 {
    font-size: 27px;
  }

  .login-intro p,
  .login-caption,
  .eyebrow {
    display: none;
  }

  .login-form {
    padding: 40px 28px;
  }
}

.login-intro .login-brand {
  padding: 0;
}
</style>
