<script setup lang="ts">
import MemberPermissions from "~/components/groups/MemberPermissions.vue";
import { useWorkspace } from "~/composables/useWorkspace";

const { group, status } = useWorkspace();
</script>

<template>
  <LoadState
    description="请在群管理中同步群列表或添加群号。"
    :empty="!group"
    :loading="!status"
    title="未找到这个群"
  >
    <MemberPermissions v-if="group" :key="group.id" :group />
  </LoadState>
</template>
