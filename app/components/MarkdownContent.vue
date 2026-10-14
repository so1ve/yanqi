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
      /(href|src)="(?:\.\.\/)+assets\/(?:images|audio|video|files|forwards)\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-f0-9]{64}\.[a-z0-9]+)"/g,
      (_match, attribute: string, name: string) =>
        `${attribute}="/api/groups/${props.groupId}/files/${name}${attribute === "src" ? "?preview=1" : ""}"`,
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

<style scoped>
.markdown {
  line-height: 1.95;
  color: #39495d;
  overflow-wrap: anywhere;
}

.markdown :deep(h1) {
  font-size: 24px;
  margin-bottom: 20px;
  color: #243348;
}

.markdown :deep(h2) {
  font-size: 19px;
  margin: 32px 0 16px;
  padding-bottom: 9px;
  border-bottom: 1px solid #e6ebf0;
}

.markdown :deep(h3) {
  margin: 22px 0 12px;
}

.markdown :deep(p) {
  margin: 14px 0;
}

.markdown :deep(a) {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  padding-left: 24px;
}

.markdown :deep(li) {
  margin: 6px 0;
}

.markdown :deep(blockquote) {
  margin: 18px 0;
  padding: 2px 18px;
  border-left: 3px solid #b0cecc;
  background: #f6f9fa;
  color: #738397;
}

.markdown :deep(pre) {
  background: #f3f6f8;
  padding: 18px;
  overflow-x: auto;
  border-radius: 5px;
}

.markdown :deep(code) {
  font-size: 12px;
  background: #f0f4f7;
  padding: 2px 4px;
  border-radius: 3px;
}

.markdown :deep(pre code) {
  padding: 0;
}

.markdown :deep(table) {
  border-collapse: collapse;
  display: block;
  overflow: auto;
  max-width: 100%;
  font-size: 13px;
}

.markdown :deep(th),
.markdown :deep(td) {
  border: 1px solid #e2e8ef;
  padding: 9px 13px;
  text-align: left;
}

.markdown :deep(th) {
  background: #f6f8fa;
}

.markdown :deep(img) {
  max-width: 100%;
}
</style>
