import type { MaybeRefOrGetter } from "vue";
import { computed, toValue } from "vue";

import { useFetch } from "#imports";
import { errorText } from "~/utils/api";

export function useApiData<T>(path: MaybeRefOrGetter<string>) {
  const request = useFetch<T>(path, {
    baseURL: "/api",
    credentials: "same-origin",
    retry: 0,
    timeout: 15_000,
    dedupe: "defer",
    enabled: () => Boolean(toValue(path)),
  });

  return {
    data: request.data,
    loading: request.pending,
    error: computed(() =>
      request.error.value
        ? errorText(request.error.value.cause ?? request.error.value)
        : "",
    ),
    refresh: () => request.refresh(),
  };
}
