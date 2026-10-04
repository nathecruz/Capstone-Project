// Live updates for an open tab: screens listen for the kinds of data they show and fetch them
// again when the server says that data changed (the pulse in hooks/color-scheme-context.tsx).
// Also the number of unread notifications, for the bell on Home.
import { useSyncExternalStore } from 'react';

export type LiveTopic = 'claims' | 'notifications';

const topicListeners = new Map<LiveTopic, Set<() => void>>();

/** Calls `listener` whenever `topic` changes on the server; returns the unsubscribe. */
export function onLive(topic: LiveTopic, listener: () => void) {
  const listeners = topicListeners.get(topic) ?? new Set();
  listeners.add(listener);
  topicListeners.set(topic, listeners);
  return () => {
    listeners.delete(listener);
  };
}

export function emitLive(topic: LiveTopic) {
  topicListeners.get(topic)?.forEach((listener) => listener());
}

let unread = 0;
const unreadListeners = new Set<() => void>();

export function setUnreadCount(count: number) {
  if (count === unread) return;
  unread = count;
  unreadListeners.forEach((listener) => listener());
}

function subscribeUnread(listener: () => void) {
  unreadListeners.add(listener);
  return () => {
    unreadListeners.delete(listener);
  };
}

/** Unread notifications, kept current by the live pulse. */
export function useUnreadCount() {
  return useSyncExternalStore(subscribeUnread, () => unread, () => unread);
}
