<script setup lang="ts">
import { dateZhCN, zhCN } from "naive-ui";

import { theme } from "~/theme";
</script>

<template>
  <NConfigProvider
    :date-locale="dateZhCN"
    :locale="zhCN"
    :theme-overrides="theme"
  >
    <NMessageProvider>
      <NDialogProvider>
        <NuxtLayout><NuxtPage /></NuxtLayout>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
