<script setup lang="ts">
defineProps<{ items: { label: string; value: string; note: string }[] }>();
</script>

<template>
  <div class="stat-grid">
    <div v-for="item in items" :key="item.label" class="stat">
      <div class="stat-label">{{ item.label }}</div>
      <div class="stat-value">{{ item.value }}</div>
      <div class="stat-note">{{ item.note }}</div>
    </div>
  </div>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin-bottom: 28px;
  background: #fff;
  border: 1px solid #e2e8ef;
  border-radius: 8px;
  padding: 26px 8px;
}

.stat {
  padding: 0 26px;
  border-right: 1px solid #e9edf2;
}

.stat:last-child {
  border: 0;
}

.stat-label {
  color: #7c8b9b;
  font-size: 12px;
}

.stat-value {
  font-size: 32px;
  line-height: 1.7;
  font-weight: 600;
  letter-spacing: -0.8px;
  font-variant-numeric: tabular-nums;
}

.stat-note {
  color: #96a1af;
  font-size: 11px;
}

@media (max-width: 760px) {
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
    padding: 8px;
  }

  .stat {
    padding: 15px;
  }

  .stat:nth-child(2) {
    border: 0;
  }

  .stat-value {
    font-size: 28px;
  }
}
</style>
