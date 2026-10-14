import { computed, onMounted, onScopeDispose, ref, shallowRef } from "vue";

import type { Message } from "~/types/api";
import { api, errorText } from "~/utils/api";
import type { ReadingBookmark, ReadingPosition } from "~/utils/message-cache";
import {
  cacheHistory,
  cacheMessages,
  readCachedMessages,
  readHistory,
  saveReadingPosition,
} from "~/utils/message-cache";

const batchSize = 50;

export function useMessageHistory(
  groupId: string,
  source: string,
  fromLatest = false,
) {
  const messages = shallowRef<Message[]>([]);
  const ids = shallowRef<number[]>([]);
  const loaded = ref(0);
  const loading = ref(true);
  const error = ref("");
  const cacheError = ref("");
  const reactionError = ref("");
  const reactionsRead = new Set<number>();
  let events: EventSource | undefined;
  const bookmark = shallowRef<ReadingBookmark>();
  const rows = new Map<number, Message>();
  const controller = new AbortController();
  let pendingPosition: ReadingBookmark | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  async function cached<T>(
    operation: () => Promise<T>,
  ): Promise<T | undefined> {
    if (cacheError.value) {
      return;
    }

    try {
      return await operation();
    } catch {
      cacheError.value = "浏览器缓存不可用，本次阅读位置不会保存。";
    }
  }

  const range = (count: number): number[] =>
    fromLatest
      ? ids.value.slice(Math.max(0, ids.value.length - count))
      : ids.value.slice(0, count);

  function display(count: number): void {
    loaded.value = Math.min(count, ids.value.length);
    messages.value = range(loaded.value).flatMap((id) =>
      rows.has(id) ? [rows.get(id)!] : [],
    );
  }

  const readMessages = async (messageIds: number[]): Promise<Message[]> =>
    api(`groups/${groupId}/messages/read`, {
      method: "POST",
      body: { ids: messageIds },
      signal: controller.signal,
      timeout: 15_000,
    });

  async function applyReactions(
    items: { messageId: number; reactions: Message["reactions"] }[],
  ): Promise<void> {
    const changed: Message[] = [];

    for (const item of items) {
      const current = rows.get(item.messageId);

      if (
        current &&
        JSON.stringify(current.reactions ?? []) !==
          JSON.stringify(item.reactions)
      ) {
        const message = { ...current, reactions: item.reactions };

        rows.set(message.id, message);
        changed.push(message);
      }
    }

    if (changed.length > 0 && !controller.signal.aborted) {
      display(loaded.value);
      await cached(() => cacheMessages(changed));
    }
  }

  async function refreshReactions(messageIds: number[]): Promise<void> {
    const missing = (fromLatest ? messageIds.toReversed() : messageIds).filter(
      (id) => !reactionsRead.has(id),
    );

    for (const id of missing) {
      reactionsRead.add(id);
    }

    for (let start = 0; start < missing.length; start += batchSize) {
      const batch = missing.slice(start, start + batchSize);
      const previous = new Map(
        batch.map((id) => [id, rows.get(id)?.reactions]),
      );

      try {
        const result = await api<{
          items: { messageId: number; reactions: Message["reactions"] }[];
          error: string;
        }>(`groups/${groupId}/messages/reactions/read`, {
          method: "POST",
          body: { ids: batch },
          signal: controller.signal,
          timeout: 60_000,
        });

        if (controller.signal.aborted) {
          return;
        }

        if (result.error) {
          reactionError.value = result.error;
        }

        // 此次读取期间若收到新事件，保留事件里的最新状态。
        await applyReactions(
          result.items.filter(
            (item) =>
              rows.get(item.messageId)?.reactions ===
              previous.get(item.messageId),
          ),
        );
      } catch (cause) {
        if (controller.signal.aborted) {
          return;
        }

        reactionError.value = `表情回应未能更新：${errorText(cause)}`;
      }
    }
  }

  async function fill(count: number, refresh = false): Promise<void> {
    const requested = range(count);
    const stored = await cached(() =>
      readCachedMessages(
        groupId,
        requested.filter((id) => !rows.has(id)),
      ),
    );

    for (const message of stored ?? []) {
      rows.set(message.id, message);
    }

    const missing = refresh
      ? requested
      : requested.filter((id) => !rows.has(id));

    for (let start = 0; start < missing.length; start += batchSize) {
      const batch = missing.slice(start, start + batchSize);
      const items = await readMessages(batch);
      const found = new Set(items.map((message) => message.id));

      for (const message of items) {
        rows.set(message.id, message);
      }

      // 编号列表获取后，消息仍可能被历史清理删除。
      const removed = new Set(batch.filter((id) => !found.has(id)));

      if (removed.size > 0) {
        ids.value = ids.value.filter((id) => !removed.has(id));
      }

      await cached(() => cacheMessages(items));
    }

    if (!controller.signal.aborted) {
      display(count);
      if (refresh) {
        reactionsRead.clear();
      }

      void refreshReactions(requested);
      await cached(() =>
        cacheHistory(source, { ids: ids.value, loaded: loaded.value }),
      );
    }
  }

  async function loadMore(): Promise<void> {
    if (loading.value || error.value || loaded.value >= ids.value.length) {
      return;
    }

    loading.value = true;

    try {
      await fill(loaded.value + batchSize);
    } catch (cause) {
      if (!controller.signal.aborted) {
        error.value = errorText(cause);
      }
    } finally {
      loading.value = false;
    }
  }

  async function refresh(reloadMessages = true): Promise<void> {
    loading.value = true;
    error.value = "";
    reactionError.value = "";

    try {
      const currentIds = await api<number[]>(source, {
        signal: controller.signal,
        timeout: 15_000,
      });

      if (controller.signal.aborted) {
        return;
      }

      const visibleIds = new Set(messages.value.map((message) => message.id));
      const firstVisible = fromLatest
        ? currentIds.findIndex((id) => visibleIds.has(id))
        : -1;
      const count =
        firstVisible >= 0 ? currentIds.length - firstVisible : loaded.value;

      ids.value = currentIds;

      if (bookmark.value && !currentIds.includes(bookmark.value.messageId)) {
        bookmark.value = undefined;
      }

      await fill(Math.max(count, batchSize), reloadMessages);
    } catch (cause) {
      if (!controller.signal.aborted) {
        error.value = errorText(cause);
      }
    } finally {
      loading.value = false;
    }
  }

  async function refreshMessage(messageId: number): Promise<void> {
    try {
      const items = await readMessages([messageId]);

      for (const message of items) {
        rows.set(message.id, message);
      }

      await cached(() => cacheMessages(items));
      display(loaded.value);
    } catch (cause) {
      if (!controller.signal.aborted) {
        error.value = errorText(cause);
      }
    }
  }

  async function reveal(messageId: number): Promise<boolean> {
    const index = ids.value.indexOf(messageId);

    if (index === -1) {
      return false;
    }

    const count = fromLatest ? ids.value.length - index : index + 1;

    if (count > loaded.value) {
      loading.value = true;

      try {
        await fill(count);
      } catch (cause) {
        if (!controller.signal.aborted) {
          error.value = errorText(cause);
        }

        return false;
      } finally {
        loading.value = false;
      }
    }

    return rows.has(messageId);
  }

  function savePosition(): void {
    clearTimeout(saveTimer);
    const position = pendingPosition;

    if (position) {
      pendingPosition = undefined;
      void cached(() => saveReadingPosition(source, position));
    }
  }

  function remember(position: ReadingPosition): void {
    const message = rows.get(position.messageId);

    if (!message) {
      return;
    }

    pendingPosition = {
      ...position,
      sentAt: message.sentAt,
      preview: `${message.displayName}: ${message.text || "附件消息"}`.slice(
        0,
        90,
      ),
    };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 250);
  }

  async function initialize(): Promise<void> {
    const saved = await cached(() => readHistory(source));

    if (saved?.history) {
      ids.value = saved.history.ids;
      const stored = await cached(() =>
        readCachedMessages(groupId, range(saved.history!.loaded)),
      );

      for (const message of stored ?? []) {
        rows.set(message.id, message);
      }

      display(saved.history.loaded);
    }

    bookmark.value = saved?.bookmark;

    if (!controller.signal.aborted) {
      await refresh(false);
    }
  }

  onMounted(() => {
    window.addEventListener("pagehide", savePosition);
    events = new EventSource(
      `/api/groups/${groupId}/messages/reactions/events`,
    );
    events.addEventListener("reactions", (event) => {
      void applyReactions([JSON.parse(event.data)]);
    });
    events.addEventListener("ready", () => {
      reactionsRead.clear();
      void refreshReactions(range(loaded.value));
    });
    void initialize();
  });
  onScopeDispose(() => {
    controller.abort();
    events?.close();
    window.removeEventListener("pagehide", savePosition);
    savePosition();
  });

  return {
    messages,
    loading,
    error,
    cacheError,
    reactionError,
    bookmark,
    total: computed(() => ids.value.length),
    finished: computed(() => loaded.value >= ids.value.length),
    loadMore,
    refresh,
    refreshMessage,
    remember,
    reveal,
  };
}
