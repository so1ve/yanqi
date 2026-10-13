<script setup lang="ts">
import { ChevronRight, Logout, Messages, Settings, X } from "@vicons/tabler";

import { navigateTo, useRoute } from "#imports";
import { useAction } from "~/composables/useAction";
import { useNavigation } from "~/composables/useNavigation";
import { useWorkspace } from "~/composables/useWorkspace";
import { api } from "~/utils/api";

const open = defineModel<boolean>("open", { required: true });
const route = useRoute();
const { groups, groupId } = useWorkspace();
const { links, groupLinks, selected } = useNavigation();
const { run } = useAction();

async function logout(): Promise<void> {
  await run(async () => {
    await api("logout", { method: "POST" });
    await navigateTo("/login");
  });
}
</script>

<template>
  <button
    v-if="open"
    aria-label="关闭导航"
    class="nav-backdrop"
    @click="open = false"
  />
  <aside class="sidebar" :class="{ 'is-open': open }">
    <NuxtLink to="/"><AppBrand caption="管理台" /></NuxtLink>
    <NButton aria-label="关闭导航" class="nav-close" text @click="open = false">
      <NIcon :component="X" />
    </NButton>
    <nav aria-label="主导航" class="navigation">
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
      <div class="nav-section-title">群聊</div>
      <details
        v-for="item in groups"
        :key="item.id"
        class="group-menu"
        :open="item.id === groupId"
      >
        <summary :title="`${item.name} (${item.id})`">
          <NIcon :component="Messages" />
          <span>{{ item.name }}</span>
          <NIcon class="group-arrow" :component="ChevronRight" size="13" />
        </summary>
        <div class="group-children">
          <NuxtLink
            v-for="link in groupLinks"
            :key="link.path"
            class="nav-link"
            :class="{
              active: item.id === groupId && link.label === selected,
            }"
            :to="`/${item.id}/${link.path}`"
            @click="open = false"
          >
            <NIcon :component="link.icon" />
            <span>{{ link.label }}</span>
          </NuxtLink>
        </div>
      </details>
      <NuxtLink
        v-if="groups.length === 0"
        class="empty-groups"
        to="/groups"
        @click="open = false"
      >
        添加或同步群聊
      </NuxtLink>
    </nav>
    <div class="sidebar-bottom">
      <NuxtLink
        class="nav-link"
        :class="{ active: route.path === '/settings' }"
        to="/settings"
        @click="open = false"
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
</template>

<style scoped>
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: var(--sidebar-width);
  border-right: 1px solid #e2e8ef;
  background: #fbfcfd;
  padding: 30px 16px 20px;
  display: flex;
  flex-direction: column;
  z-index: 30;
}

.navigation {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: 30px;
}

.nav-section-title {
  color: #8a97a7;
  font-size: 11px;
  margin: 22px 12px 10px;
  letter-spacing: 1px;
}

.group-menu summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 8px 12px;
  color: #526376;
  cursor: pointer;
  list-style: none;
  border-radius: 6px;
}

.group-menu summary::-webkit-details-marker {
  display: none;
}

.group-menu summary:hover {
  background: #f0f4f7;
}

.group-menu summary span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-menu summary .n-icon {
  flex-shrink: 0;
}

.group-menu[open] .group-arrow {
  transform: rotate(90deg);
}

.group-children {
  margin: 3px 0 12px 18px;
  padding-left: 5px;
  border-left: 1px solid #e2e8ef;
}

.group-children .nav-link {
  height: 37px;
  font-size: 13px;
  gap: 9px;
  margin-bottom: 2px;
}

.empty-groups {
  display: block;
  padding: 8px 12px;
  font-size: 12px;
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
  padding-top: 20px;
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

.nav-close,
.nav-backdrop {
  display: none;
}

@media (max-width: 760px) {
  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.2s;
  }

  .sidebar.is-open {
    transform: translateX(0);
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
}
</style>
