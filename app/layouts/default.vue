<script setup lang="ts">
import {
  Activity,
  Book2,
  Bulb,
  ChartBar,
  ChevronRight,
  Dashboard,
  Logout,
  Menu2,
  Messages,
  Settings,
  Users,
  X,
} from "@vicons/tabler";
import { computed, onMounted, ref } from "vue";

import { navigateTo, useRoute } from "#imports";
import { useAction } from "~/composables/useAction";
import { usePoll } from "~/composables/usePoll";
import { useWorkspace } from "~/composables/useWorkspace";
import type { Status } from "~/types/api";
import { api, errorText } from "~/utils/api";

const workspace = useWorkspace();
const { groups, groupId, status, groupLink, selectGroup } = workspace;
const route = useRoute();
const { busy, run } = useAction();
const open = ref(false);
const error = ref("");
const links = [
  { path: "/", label: "概览", icon: Dashboard },
  { path: "/records", label: "纪要", icon: Book2 },
  { path: "/messages", label: "原始消息", icon: Messages },
  { path: "/groups", label: "群与成员", icon: Users },
  { path: "/tasks", label: "后台任务", icon: Activity },
  { path: "/memories", label: "记忆", icon: Bulb },
  { path: "/usage", label: "模型用量", icon: ChartBar },
  { path: "/logs", label: "运行日志", icon: Activity },
];
const selected = computed(
  () =>
    links.find((link) =>
      link.path === "/" ? route.path === "/" : route.path.startsWith(link.path),
    )?.label ?? "设置",
);
const options = computed(() =>
  groups.value.map((group) => ({ label: group.name, value: group.id })),
);
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
async function logout(): Promise<void> {
  await run(async () => {
    await api("logout", { method: "POST" });
    await navigateTo("/login");
  });
}
</script>

<template>
  <div class="workspace">
    <button
      v-if="open"
      aria-label="关闭导航"
      class="nav-backdrop"
      @click="open = false"
    />
    <aside class="sidebar" :class="{ 'is-open': open }">
      <NuxtLink :to="groupLink('/')"><AppBrand caption="管理台" /></NuxtLink>
      <NButton
        aria-label="关闭导航"
        class="nav-close"
        text
        @click="open = false"
      >
        <NIcon :component="X" />
      </NButton>
      <div class="group-selector">
        <label for="group-selector">当前群</label>
        <NSelect
          id="group-selector"
          filterable
          :options
          placeholder="选择一个群"
          :value="groupId || null"
          @update:value="selectGroup"
        />
      </div>
      <nav aria-label="主导航">
        <NuxtLink
          v-for="link in links"
          :key="link.path"
          class="nav-link"
          :class="{ active: link.label === selected }"
          :to="groupLink(link.path)"
          @click="open = false"
        >
          <NIcon :component="link.icon" />
          <span>{{ link.label }}</span>
          <NIcon
            v-if="link.label === selected"
            class="nav-arrow"
            :component="ChevronRight"
            size="13"
          />
        </NuxtLink>
      </nav>
      <div class="sidebar-bottom">
        <NuxtLink
          class="nav-link"
          :class="{ active: route.path === '/settings' }"
          :to="groupLink('/settings')"
        >
          <NIcon :component="Settings" />
          <span>设置</span>
        </NuxtLink>
        <button class="nav-link logout" @click="logout">
          <NIcon :component="Logout" />
          <span>退出登录</span>
        </button>
        <p>本地保存 · QQ 群聊记录</p>
      </div>
    </aside>
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
          <span>言栖</span>
          <span class="separator">/</span>
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
  --page-gutter: 38px;
  --page-heading-height: 0px;
  min-height: 100vh;
}

.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 222px;
  border-right: 1px solid #e2e8ef;
  background: #fbfcfd;
  padding: 30px 16px 20px;
  display: flex;
  flex-direction: column;
  z-index: 30;
}

.group-selector {
  margin: 38px 6px 25px;
}

.group-selector label {
  display: block;
  color: #8a97a7;
  font-size: 11px;
  margin: 0 0 9px 2px;
  letter-spacing: 1px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 42px;
  padding: 0 12px;
  border-radius: 6px;
  color: #68788b;
  margin-bottom: 5px;
  transition:
    background 0.15s,
    color 0.15s;
}

.nav-link .n-icon {
  font-size: 18px;
}

.nav-link:hover {
  background: #f0f4f7;
  color: #243348;
}

.nav-link.active {
  background: #e9f2f2;
  color: #246d70;
  font-weight: 600;
}

.nav-arrow {
  margin-left: auto;
}

.sidebar-bottom {
  margin-top: auto;
  padding-top: 30px;
}

.sidebar-bottom p {
  border-top: 1px solid #e7ecf1;
  margin: 18px 8px 0;
  padding-top: 17px;
  color: #929dac;
  font-size: 11px;
}

.logout {
  border: 0;
  width: 100%;
  background: transparent;
}

.main-shell {
  margin-left: 222px;
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
  color: #8c99a9;
  font-size: 12px;
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

.mobile-menu,
.nav-close,
.nav-backdrop {
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
  }

  .sidebar {
    width: 200px;
  }

  .main-shell {
    margin-left: 200px;
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
  }

  .sidebar {
    transform: translateX(-100%);
    width: 235px;
    transition: transform 0.2s;
  }

  .sidebar.is-open {
    transform: translateX(0);
  }

  .main-shell {
    margin: 0;
  }

  .nav-close {
    display: inline-flex;
    position: absolute;
    right: 17px;
    top: 20px;
  }

  .nav-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: #24334850;
    z-index: 25;
    border: 0;
  }

  .mobile-menu {
    display: inline-flex;
  }

  .breadcrumb,
  .topbar-status {
    gap: 10px;
  }

  .breadcrumb > span,
  .connection {
    display: none;
  }

  .page-content {
    padding-block: 25px 40px;
  }
}
</style>
