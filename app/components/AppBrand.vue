<script setup lang="ts">
defineProps<{ caption?: string }>();
</script>

<template>
  <div class="brand">
    <span class="brand-mark">栖</span>
    <div>
      <strong>言栖</strong>
      <small v-if="caption">{{ caption }}</small>
    </div>
  </div>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #243348;
  padding: 0 10px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 42px;
  background: #277f80;
  color: #fff;
  border-radius: 5px 5px 13px 5px;
  font-size: 22px;
  font-weight: 500;
}

.brand strong {
  display: block;
  font-size: 21px;
  letter-spacing: 2px;
  font-weight: 650;
}

.brand small {
  display: block;
  color: #8a97a7;
  font-size: 11px;
  letter-spacing: 1.5px;
}
</style>
