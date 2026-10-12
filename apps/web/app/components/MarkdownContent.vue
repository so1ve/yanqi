<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import { computed } from "vue";

const emit = defineEmits<{ transcript: [] }>();
const props = defineProps<{ content: string; groupId?: string }>();
const html = computed(() => {
  let rendered = marked.parse(props.content, { async: false });
  if (props.groupId) {
    rendered = rendered.replace(
      /href="(?:\.\.\/)+assets\/(\d+)\.[a-z]+"/g,
      `href="/api/groups/${props.groupId}/assets/$1"`,
    );
  }

  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["form", "input", "button", "style", "iframe"],
  });
});
function follow(event: MouseEvent): void {
  const link = (event.target as HTMLElement).closest("a");
  if (link?.getAttribute("href") === "transcript.md") {
    event.preventDefault();
    emit("transcript");
  }
}
</script>

<template><div class="markdown" @click="follow" v-html="html" /></template>
