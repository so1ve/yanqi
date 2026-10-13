import { onMounted, onScopeDispose } from "vue";

export function usePoll(refresh: () => Promise<void>, interval = 5000): void {
  let timer: ReturnType<typeof setInterval> | undefined;

  onMounted(() => {
    timer = setInterval(() => {
      if (!document.hidden) {
        void refresh();
      }
    }, interval);
  });
  onScopeDispose(() => clearInterval(timer));
}
