import { useMessage } from "naive-ui";
import { ref } from "vue";

import { errorText } from "~/utils/api";

export function useAction() {
  const busy = ref(false);
  const message = useMessage();

  async function run(
    action: () => Promise<unknown>,
    success?: string,
  ): Promise<boolean> {
    if (busy.value) {
      return false;
    }

    busy.value = true;
    try {
      await action();
      if (success) {
        message.success(success);
      }

      return true;
    } catch (error) {
      message.error(errorText(error));

      return false;
    } finally {
      busy.value = false;
    }
  }

  return { busy, run };
}
