// ============================================================
// Messaging store — unread count polling
// ============================================================
import { getMessageUnreadCount as readUnreadCount } from '../lib/messages.remote';
import { getCurrentUser } from './user.svelte';

let unreadCount: number = $state(0);
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function getMessageUnreadCount() {
  return unreadCount;
}

export async function fetchMessageUnreadCount() {
  const user = getCurrentUser()?.id;
  if (!user) return;
  try {
    await readUnreadCount().refresh();
    const res = await readUnreadCount();
    if (res && getCurrentUser()?.id === user) unreadCount = res.count;
  } catch {
    // silently fail
  }
}

export function incrementMessageUnreadCount() {
  unreadCount++;
}

export function startMessagePolling(intervalMs = 30_000) {
  stopMessagePolling();
  fetchMessageUnreadCount();
  pollTimer = setInterval(fetchMessageUnreadCount, intervalMs);
}

export function stopMessagePolling() {
  unreadCount = 0;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
