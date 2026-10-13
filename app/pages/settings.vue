<script setup lang="ts">
import { DeviceFloppy, ExternalLink } from "@vicons/tabler";
import type { Config } from "@yanqi/bot";
import { computed, ref, watch } from "vue";

import ModelsForm from "~/components/settings/ModelsForm.vue";
import PasswordForm from "~/components/settings/PasswordForm.vue";
import StorageForm from "~/components/settings/StorageForm.vue";
import { useAction } from "~/composables/useAction";
import { useApiData } from "~/composables/useApiData";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Settings } from "~/types/api";
import { api } from "~/utils/api";

const { data, loading, error, refresh } = useApiData<Settings>("settings");
const draft = ref<Config | null>(null);
const autostart = ref(true);
const napcatWebUrl = ref("");
const admins = ref("");
const { busy, run } = useAction();
const workspace = useWorkspace();
const tab = ref("connection");
watch(data, (value) => {
  if (value) {
    draft.value = structuredClone(value.config);
    autostart.value = value.autostart;
    napcatWebUrl.value = value.napcatWebUrl;
    admins.value = value.config.ADMIN_IDS.join(", ");
  }
});
const safeNapcatUrl = computed(() =>
  /^https?:\/\//.test(napcatWebUrl.value) ? napcatWebUrl.value : "",
);
async function save(): Promise<void> {
  if (!draft.value) {
    return;
  }
  draft.value.ADMIN_IDS = admins.value.split(/[,，\s]+/).filter(Boolean);
  await run(async () => {
    data.value = await api<Settings>("settings", {
      method: "PUT",
      body: {
        config: draft.value,
        autostart: autostart.value,
        napcatWebUrl: napcatWebUrl.value,
      },
    });
    await workspace.refresh();
  }, "设置已保存并应用");
}
</script>

<template>
  <PageHeading description="保存后生效，服务重启后保留。" title="设置">
    <NButton :disabled="!draft" :loading="busy" type="primary" @click="save">
      <template #icon><NIcon :component="DeviceFloppy" /></template>
      保存并应用
    </NButton>
  </PageHeading>
  <LoadState :error :loading @retry="refresh">
    <template v-if="draft">
      <NTabs v-model:value="tab" animated type="line">
        <NTabPane name="connection" tab="连接与启动">
          <NForm class="settings-section">
            <div class="section-title">
              <h2>NapCat 连接</h2>
              <p>先在 NapCat 管理页登录 QQ，再填写下方连接信息。</p>
            </div>
            <FormGrid>
              <NFormItem label="机器人 QQ 号">
                <NInput
                  v-model:value="draft.BOT_QQ"
                  placeholder="登录 NapCat 的 QQ 号"
                />
              </NFormItem>
              <NFormItem label="WebSocket 地址">
                <NInput
                  v-model:value="draft.ONEBOT_URL"
                  placeholder="ws://napcat:3001"
                />
              </NFormItem>
              <NFormItem class="full-width" label="OneBot Token">
                <div class="w-full">
                  <NInput
                    v-model:value="draft.ONEBOT_TOKEN"
                    autocomplete="off"
                    placeholder="与 NapCat WebSocket 服务端一致"
                  />
                  <p class="form-help">
                    在 NapCat 中启用 WebSocket 服务端，消息格式选
                    array，打开“上报自身消息”。此处填写同一个 Token。
                  </p>
                </div>
              </NFormItem>
              <NFormItem class="full-width" label="NapCat 管理页地址">
                <div class="w-full">
                  <NInput
                    v-model:value="napcatWebUrl"
                    placeholder="http://localhost:6099"
                  />
                  <a
                    v-if="safeNapcatUrl"
                    class="external-link"
                    :href="safeNapcatUrl"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    打开 NapCat 管理页
                    <NIcon :component="ExternalLink" />
                  </a>
                </div>
              </NFormItem>
            </FormGrid>
            <div class="section-title mt-16"><h2>启动与交互权限</h2></div>
            <NFormItem label="服务启动时自动运行机器人">
              <div>
                <NSwitch v-model:value="autostart" />
                <p class="form-help">
                  默认开启。首次填齐连接、模型和记录群后自动运行。
                </p>
              </div>
            </NFormItem>
            <NFormItem label="全局管理员 QQ 号">
              <div class="w-full">
                <NInput
                  v-model:value="admins"
                  :autosize="{ minRows: 2, maxRows: 5 }"
                  placeholder="逗号或换行分隔"
                  type="textarea"
                />
                <p class="form-help">
                  对所有群生效。群主和群管理员已有交互权限，其他成员可在“群与成员”中授权。
                </p>
              </div>
            </NFormItem>
            <NFormItem label="数据目录">
              <NInput readonly :value="data?.dataDirectory" />
            </NFormItem>
            <p class="form-help">
              保存设置会中断当前对话。后台整理会使用新设置继续。
            </p>
          </NForm>
        </NTabPane>
        <NTabPane name="models" tab="模型服务">
          <ModelsForm v-model="draft" />
        </NTabPane>
        <NTabPane name="decision" tab="请求识别">
          <NForm>
            <DecisionEditor v-model="draft" />
          </NForm>
        </NTabPane>
        <NTabPane name="persona" tab="人设提示词">
          <section class="settings-section">
            <div class="section-title">
              <h2>小栖怎么说话</h2>
              <p>人设只影响表达，不能改变事实、权限、记录范围和发送决定。</p>
            </div>
            <NInput
              v-model:value="draft.BOT_PERSONA"
              :autosize="{ minRows: 16, maxRows: 30 }"
              placeholder="描述小栖的个性和说话习惯"
              type="textarea"
            />
            <p class="form-help">用于群回复和纪要保存通知。</p>
          </section>
        </NTabPane>
        <NTabPane name="runtime" tab="运行参数">
          <NForm><RuntimeEditor v-model="draft" /></NForm>
        </NTabPane>
        <NTabPane name="storage" tab="存储与清理">
          <StorageForm
            v-model="draft"
            :saved-days="data!.config.HISTORY_RETENTION_DAYS"
          />
        </NTabPane>
        <NTabPane name="security" tab="管理密码">
          <PasswordForm />
        </NTabPane>
      </NTabs>
    </template>
  </LoadState>
</template>

<style scoped>
.form-help {
  font-size: 12px;
  color: #8a97a7;
  margin-top: 7px;
}

.external-link {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  margin-top: 10px;
}

.mt-16 {
  margin-top: 16px;
}

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
