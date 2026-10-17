import { createEventStream, defineEventHandler, getRouterParam } from "h3";

import { groupParam, integer, requireItem } from "~~/server/utils/http";

export default defineEventHandler(async (event) => {
  const groupId = groupParam(event);
  const { bot } = event.context;
  const asset = requireItem(
    await bot.store.assets.find(groupId, integer(getRouterParam(event, "id"))),
  );
  const job = await bot.store.jobs.forAsset(asset.id);
  const stream = createEventStream(event);
  const controller = new AbortController();

  stream.onClosed(() => controller.abort());
  void (async () => {
    try {
      await stream.push({ event: "ready", data: "{}" });
      const result = await bot.store.jobs.wait(
        groupId,
        job.id,
        controller.signal,
        true,
      );

      await stream.push({
        event: "finished",
        data: JSON.stringify({ error: result.lastError }),
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        await stream
          .push({
            event: "finished",
            data: JSON.stringify({ error: String(error) }),
          })
          .catch(() => stream.close());
      }
    } finally {
      await stream.close();
    }
  })();

  return stream.send();
});
