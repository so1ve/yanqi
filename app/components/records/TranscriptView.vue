<script setup lang="ts">
import type { Note } from "@yanqi/bot";

import RecordReader from "~/components/records/RecordReader.vue";
import { useApiData } from "~/composables/useApiData";

const props = defineProps<{ note: Note }>();
const { data, error, loading, refresh } = useApiData<string>(
  () =>
    `groups/${props.note.groupId}/records/${props.note.topicId}/transcript?version=${props.note.id}`,
);
</script>

<template>
  <LoadState :error :loading @retry="refresh">
    <RecordReader>
      <div class="transcript">{{ data }}</div>
    </RecordReader>
  </LoadState>
</template>

<style scoped>
.transcript {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 2;
  font-size: 13px;
}
</style>
