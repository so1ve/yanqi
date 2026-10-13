<script setup lang="ts">
import { Robot } from "@vicons/tabler";

defineProps<{
  userId: string;
  name: string;
  isBot?: boolean;
  size?: number;
}>();
</script>

<template>
  <NAvatar
    aria-hidden="true"
    class="user-avatar"
    :class="{ 'bot-avatar': isBot }"
    :img-props="{ alt: '', decoding: 'async' }"
    lazy
    object-fit="cover"
    :size="size ?? 38"
    :src="`/api/avatars/${userId}`"
    :style="{ '--avatar-hue': Number(userId) % 360 }"
  >
    <template #fallback>
      <NIcon v-if="isBot" :component="Robot" :size="21" />
      <span v-else>{{ Array.from(name)[0] }}</span>
    </template>
  </NAvatar>
</template>

<style scoped>
.user-avatar {
  flex-shrink: 0;
  border-radius: 12px;
  background: hsl(var(--avatar-hue) 35% 89%);
  color: hsl(var(--avatar-hue) 30% 33%);
  font-size: 16px;
  font-weight: 600;
}

.bot-avatar {
  color: #fff;
  background: #277f80;
}
</style>
