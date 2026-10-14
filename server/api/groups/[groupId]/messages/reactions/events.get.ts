import { createEventStream, defineEventHandler } from "h3";

import { groupParam } from "~~/server/utils/http";

export default defineEventHandler((event) => {
  const groupId = groupParam(event);
  const stream = createEventStream(event);
  const unsubscribe = event.context.bot.reactions.subscribe(
    groupId,
    (update) => {
      void stream
        .push({ event: "reactions", data: JSON.stringify(update) })
        .catch(() => stream.close());
    },
  );

  stream.onClosed(unsubscribe);
  // 立即建立连接，浏览器重连时补读当前窗口；之后仅在回应变化时推送。
  void stream.push({ event: "ready", data: "{}" });

  return stream.send();
});
