import { onMounted, onScopeDispose } from "vue";

export function usePoll(refresh: () => Promise<void>, interval = 5000): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> | undefined;

  onMounted(() => {
    timer = setInterval(() => {
      if (!document.hidden && !pending) {
        pending = refresh().finally(() => {
          pending = undefined;
        });
      }
    }, interval);
  });
  onScopeDispose(() => clearInterval(timer));
}
