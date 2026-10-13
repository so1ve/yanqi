import type { MaybeRefOrGetter } from "vue";
import { onScopeDispose, ref, shallowRef, toValue, watch } from "vue";

import { api, errorText } from "~/utils/api";

export function useApiData<T>(path: MaybeRefOrGetter<string>) {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref("");
  let controller: AbortController | null = null;

  async function refresh(): Promise<void> {
    controller?.abort();
    const current = new AbortController();

    controller = current;
    const url = toValue(path);

    error.value = "";
    if (!url) {
      data.value = null;
      loading.value = false;

      return;
    }

    loading.value = true;
    try {
      data.value = await api<T>(url, {
        signal: current.signal,
        timeout: 15_000,
      });
    } catch (failure) {
      if (!current.signal.aborted) {
        error.value = errorText(failure);
      }
    } finally {
      if (controller === current) {
        loading.value = false;
      }
    }
  }

  watch(
    () => toValue(path),
    () => {
      data.value = null;
      void refresh();
    },
    { immediate: true },
  );
  onScopeDispose(() => controller?.abort());

  return { data, loading, error, refresh };
}
