<script setup lang="ts">
import { ref } from "vue";

import { useAction } from "~/composables/useAction";
import { api } from "~/utils/api";

const { busy, run } = useAction();
const currentPassword = ref("");
const newPassword = ref("");
async function changePassword(): Promise<void> {
  if (
    await run(
      () =>
        api("password", {
          method: "PUT",
          body: { current: currentPassword.value, password: newPassword.value },
        }),
      "密码已修改，其他登录已失效",
    )
  ) {
    currentPassword.value = "";
    newPassword.value = "";
  }
}
</script>

<template>
  <NForm
    class="settings-section password-form"
    @submit.prevent="changePassword"
  >
    <div class="section-title">
      <h2>修改管理密码</h2>
      <p>修改后，其他已登录的设备需要重新登录。</p>
    </div>
    <NFormItem label="当前密码">
      <NInput
        v-model:value="currentPassword"
        autocomplete="current-password"
        type="password"
      />
    </NFormItem>
    <NFormItem label="新密码">
      <NInput
        v-model:value="newPassword"
        autocomplete="new-password"
        placeholder="至少 10 个字符"
        show-password-on="click"
        type="password"
      />
    </NFormItem>
    <NButton
      attr-type="submit"
      :disabled="newPassword.length < 10 || !currentPassword"
      :loading="busy"
      type="primary"
    >
      修改密码
    </NButton>
  </NForm>
</template>

<style scoped>
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

.password-form {
  max-width: 500px;
}
</style>
