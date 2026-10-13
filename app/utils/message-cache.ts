import type { DBSchema } from "idb";
import { openDB } from "idb";

import type { Message } from "~/types/api";

export interface ReadingPosition {
  messageId: number;
  offset: number;
}

export interface ReadingBookmark extends ReadingPosition {
  sentAt: number;
  preview: string;
}

interface History {
  ids: number[];
  loaded: number;
}

interface MessageCache extends DBSchema {
  messages: { key: [string, number]; value: Message };
  histories: { key: string; value: History };
  bookmarks: { key: string; value: ReadingBookmark };
}

let database: ReturnType<typeof openDB<MessageCache>> | undefined;

const openCache = () =>
  (database ??= openDB<MessageCache>("yanqi-messages", 1, {
    upgrade(db) {
      db.createObjectStore("messages", { keyPath: ["groupId", "id"] });
      db.createObjectStore("histories");
      db.createObjectStore("bookmarks");
    },
  }));

export async function readHistory(key: string) {
  const db = await openCache();
  const tx = db.transaction(["histories", "bookmarks"]);
  const [history, bookmark] = await Promise.all([
    tx.objectStore("histories").get(key),
    tx.objectStore("bookmarks").get(key),
  ]);

  return { history, bookmark };
}

export async function readCachedMessages(groupId: string, ids: number[]) {
  const db = await openCache();
  const tx = db.transaction("messages");
  const messages = await Promise.all(
    ids.map((id) => tx.store.get([groupId, id])),
  );

  return messages.filter((message) => message !== undefined);
}

export async function cacheMessages(messages: Message[]): Promise<void> {
  const db = await openCache();
  const tx = db.transaction("messages", "readwrite");

  await Promise.all([
    ...messages.map((message) => tx.store.put(message)),
    tx.done,
  ]);
}

export async function cacheHistory(
  key: string,
  history: History,
): Promise<void> {
  const db = await openCache();

  await db.put("histories", history, key);
}

export async function saveReadingPosition(
  key: string,
  bookmark: ReadingBookmark,
): Promise<void> {
  const db = await openCache();

  await db.put("bookmarks", bookmark, key);
}
