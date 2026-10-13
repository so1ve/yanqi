import { computed } from "vue";

import { useRoute, useRouter } from "#imports";

export function useQueryValue<T extends string | number | null>(
  key: string,
  parse: (value: string | undefined) => T,
  options: { reset?: string[]; replace?: boolean } = {},
) {
  const route = useRoute();
  const router = useRouter();

  return computed({
    get: () => {
      const value = route.query[key];

      return parse(typeof value === "string" ? value : undefined);
    },
    set: (value: T) => {
      const query = { ...route.query };

      for (const name of options.reset ?? []) {
        delete query[name];
      }

      if (value === null || value === "") {
        delete query[key];
      } else {
        query[key] = String(value);
      }

      void router[options.replace ? "replace" : "push"]({
        query,
        hash: route.hash,
      });
    },
  });
}

export function positiveInteger(value: string | undefined): number | null {
  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
