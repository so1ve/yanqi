<script setup lang="ts">
import type { Note } from "@yanqi/bot";

import { useApiData } from "~/composables/useApiData";

const props = defineProps<{ note: Note }>();
const { data, error, loading, refresh } = useApiData<string>(
  () =>
    `groups/${props.note.groupId}/records/${props.note.topicId}/transcript?version=${props.note.id}`,
);
</script>

<template>
  <LoadState :error :loading @retry="refresh">
    <article class="reader">
      <div class="transcript">{{ data }}</div>
    </article>
  </LoadState>
</template>
