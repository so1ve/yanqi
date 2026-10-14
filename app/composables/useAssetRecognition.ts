import { useMessage } from "naive-ui";
import { onScopeDispose, ref } from "vue";

import { useAction } from "~/composables/useAction";
import { api } from "~/utils/api";

export function useAssetRecognition(
  groupId: () => string,
  id: () => number,
  updated: () => void,
) {
  const { run } = useAction();
  const message = useMessage();
  const processing = ref(false);
  let stream: EventSource | undefined;
  let disposed = false;

  onScopeDispose(() => {
    disposed = true;
    stream?.close();
  });

  async function retry() {
    if (processing.value) {
      return;
    }

    processing.value = true;
    const path = `groups/${groupId()}/assets/${id()}`;
    const queued = await run(
      () => api(`${path}/retry`, { method: "POST" }),
      "已安排重新识别；失败时保留原有结果",
    );

    if (!queued || disposed) {
      processing.value = false;

      return;
    }

    stream = new EventSource(`/api/${path}/events`);
    stream.addEventListener("finished", (event) => {
      const result = JSON.parse(event.data) as { error: string | null };

      stream?.close();
      processing.value = false;
      if (result.error) {
        message.error(result.error);
      } else {
        message.success("识别完成");
      }

      updated();
    });
    stream.onerror = () => {
      stream?.close();
      processing.value = false;
      message.warning("状态连接已断开，可刷新页面或在后台任务中查看结果");
      updated();
    };
  }

  return { processing, retry };
}
