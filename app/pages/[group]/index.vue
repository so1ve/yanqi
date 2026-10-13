<script setup lang="ts">
import { navigateTo } from "#imports";
import { useWorkspace } from "~/composables/useWorkspace";

const { groupId } = useWorkspace();
await navigateTo(`/${groupId.value}/records`, { replace: true });
</script>

<template><div /></template>
