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
const { groups, groupId, status } = workspace;
const route = useRoute();
const { busy, run } = useAction();
const open = ref(false);
const error = ref("");
const links = [
  { path: "/", label: "工作台", icon: Dashboard },
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
function changeGroup(id: string): void {
  groupId.value = id;
  if (route.path.startsWith("/records/")) {
    void navigateTo("/records");
  }
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
      <NuxtLink class="brand" to="/">
        <span class="brand-mark">栖</span>
        <span>
          <strong>言栖</strong>
          <small>记录工作台</small>
        </span>
      </NuxtLink>
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
          @update:value="changeGroup"
        />
      </div>
      <nav aria-label="主导航">
        <NuxtLink
          v-for="link in links"
          :key="link.path"
          class="nav-link"
          :class="{ active: link.label === selected }"
          :to="link.path"
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
          to="/settings"
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
      <div class="topbar">
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
            {{ status?.running ? "正在处理消息" : "处理已暂停" }}
          </span>
          <NButton
            :loading="busy"
            size="small"
            :type="status?.running ? 'default' : 'primary'"
            @click="toggle"
          >
            {{ status?.running ? "停止处理" : "启动机器人" }}
          </NButton>
        </div>
      </div>
      <main class="page-content">
        <NAlert v-if="error" :bordered="false" class="load-error" type="error">
          {{ error }}
        </NAlert>
        <slot />
      </main>
    </div>
  </div>
</template>
