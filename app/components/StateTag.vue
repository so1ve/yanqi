<script setup lang="ts">
import type { TagProps } from "naive-ui";
import { computed } from "vue";

import { stateNames } from "~/utils/labels";

const props = defineProps<{ state: string }>();
const types: Record<string, TagProps["type"]> = {
  running: "info",
  active: "info",
  done: "success",
  failed: "error",
  pending: "warning",
};
const type = computed(() => types[props.state] ?? "default");
</script>

<template>
  <NTag :bordered="false" round size="small" :type>
    {{ stateNames[state] ?? state }}
  </NTag>
</template>
