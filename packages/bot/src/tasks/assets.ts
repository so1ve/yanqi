import type { Store } from "../storage/store.ts";

// 在消费结果的一侧等待，附件队列始终可以继续下载和识别。
export async function waitForAsset(
  store: Store,
  groupId: string,
  assetId: number,
  signal?: AbortSignal,
): Promise<void> {
  const job = await store.jobs.forAsset(assetId);

  await store.jobs.wait(groupId, job.id, signal);
  const asset = await store.assets.get(assetId);

  await Promise.all(
    (await store.assets.inForward(asset)).map(async (child) => {
      const task = await store.jobs.forAsset(child.id);

      await store.jobs.wait(groupId, task.id, signal);
    }),
  );
}
