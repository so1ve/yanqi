<script setup lang="ts">
import { definePageMeta } from "#imports";

definePageMeta({
  validate: (route) =>
    typeof route.params.group === "string" && /^\d+$/.test(route.params.group),
});
</script>

<template>
  <NuxtPage />
</template>
