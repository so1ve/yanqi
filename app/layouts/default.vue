<script setup lang="ts">
import { Menu2 } from "@vicons/tabler";
import { onMounted, ref } from "vue";

import WorkspaceSidebar from "~/components/WorkspaceSidebar.vue";
import { useAction } from "~/composables/useAction";
import { useNavigation } from "~/composables/useNavigation";
import { usePoll } from "~/composables/usePoll";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Status } from "~/types/api";
import { api, errorText } from "~/utils/api";

const workspace = useWorkspace();
const { groupId, group, status } = workspace;
const { selected } = useNavigation();
const { busy, run } = useAction();
const open = ref(false);
const error = ref("");

onMounted(async () => {
  try {
    await workspace.refresh();
  } catch (failure) {
    error.value = errorText(failure);
  }
});

usePoll(async () => {
  try {
    status.value = await api<Status>("status");
    error.value = "";
  } catch (failure) {
    error.value = errorText(failure);
  }
});

async function toggle(): Promise<void> {
  await run(async () => {
    await api(`bot/${status.value?.running ? "stop" : "start"}`, {
      method: "POST",
    });
    await workspace.refresh();
  });
}
</script>

<template>
  <div class="workspace">
    <WorkspaceSidebar v-model:open="open" />
    <div class="main-shell">
      <header class="topbar">
        <div class="breadcrumb">
          <NButton
            aria-label="打开导航"
            class="mobile-menu"
            text
            @click="open = true"
          >
            <NIcon :component="Menu2" size="22" />
          </NButton>
          <NuxtLink class="breadcrumb-home" to="/">言栖</NuxtLink>
          <span class="separator">/</span>
          <template v-if="groupId">
            <NuxtLink
              class="breadcrumb-group"
              :title="group?.name ?? groupId"
              :to="`/${groupId}`"
            >
              {{ group?.name ?? groupId }}
            </NuxtLink>
            <span class="separator">/</span>
          </template>
          <strong>{{ selected }}</strong>
        </div>
        <div class="topbar-status">
          <span class="connection">
            <i :class="{ online: status?.connected }" />
            {{ status?.connected ? "NapCat 已连接" : "NapCat 未连接" }}
          </span>
          <span class="runtime-label">
            {{ status?.running ? "AI 处理中" : "AI 处理已暂停" }}
          </span>
          <NButton
            :loading="busy"
            size="small"
            :type="status?.running ? 'default' : 'primary'"
            @click="toggle"
          >
            {{ status?.running ? "暂停 AI" : "启动 AI" }}
          </NButton>
        </div>
      </header>
      <main class="page-content">
        <NAlert v-if="error" :bordered="false" class="load-error" type="error">
          {{ error }}
        </NAlert>
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.load-error {
  margin-bottom: 20px;
}

.workspace {
  --topbar-height: 70px;
  --sidebar-width: 222px;
  --page-gutter: 38px;
  --page-heading-height: 0px;
  min-height: 100vh;
}

.main-shell {
  margin-left: var(--sidebar-width);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 24;
  height: var(--topbar-height);
  border-bottom: 1px solid #e2e8ef;
  background: #fcfdff;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 var(--page-gutter);
  gap: 18px;
}

.breadcrumb,
.topbar-status {
  display: flex;
  align-items: center;
  gap: 18px;
  white-space: nowrap;
}

.breadcrumb {
  min-width: 0;
  color: #8c99a9;
  font-size: 12px;
}

.breadcrumb-home {
  color: inherit;
}

.breadcrumb-group {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.breadcrumb strong {
  color: #526376;
  font-weight: 500;
}

.separator {
  color: #c2cbd5;
}

.connection {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #68788b;
  font-size: 12px;
}

.connection i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #aab5c2;
}

.connection i.online {
  background: #468c76;
  box-shadow: 0 0 0 3px #e5f0ea;
}

.runtime-label {
  color: #8c99a9;
  font-size: 12px;
  border-left: 1px solid #e2e8ef;
  padding-left: 18px;
}

.page-content {
  max-width: 1540px;
  padding: 36px var(--page-gutter) 60px;
  margin: 0 auto;
}

.mobile-menu {
  display: none;
}

@media (min-width: 1600px) {
  .page-content {
    padding-top: 45px;
  }
}

@media (max-width: 1100px) {
  .workspace {
    --page-gutter: 24px;
    --sidebar-width: 200px;
  }

  .page-content {
    padding-block: 28px 45px;
  }

  .runtime-label {
    display: none;
  }
}

@media (max-width: 760px) {
  .workspace {
    --topbar-height: 62px;
    --page-gutter: 18px;
    --sidebar-width: 235px;
  }

  .main-shell {
    margin: 0;
  }

  .mobile-menu {
    display: inline-flex;
  }

  .breadcrumb,
  .topbar-status {
    gap: 10px;
  }

  .breadcrumb > span,
  .breadcrumb-home,
  .breadcrumb-group,
  .connection {
    display: none;
  }

  .page-content {
    padding-block: 25px 40px;
  }
}
</style>
