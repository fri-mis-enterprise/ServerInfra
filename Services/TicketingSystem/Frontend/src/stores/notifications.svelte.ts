// ============================================================
// Notification store — polls unread count for the bell badge
// ============================================================
import { getNotifications as readNotifications, getNotificationUnreadCount, markNotificationRead, markAllNotificationsRead } from '../lib/notifications.remote';
import { getCurrentUser } from './user.svelte';

let unreadCount: number = $state(0);
let notifications = $state<Awaited<ReturnType<typeof readNotifications>>['data']>([]);
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function getUnreadCount() {
  return unreadCount;
}

export function getNotifications() {
  return notifications;
}

export async function fetchUnreadCount() {
  const user = getCurrentUser()?.id;
  if (!user) return;
  try {
    await getNotificationUnreadCount().refresh();
    const res = await getNotificationUnreadCount();
    if (res && getCurrentUser()?.id === user) unreadCount = res.count;
  } catch {
    // silently fail — non-critical
  }
}

export async function fetchNotifications(page = 1, limit = 20) {
  const user = getCurrentUser()?.id;
  if (!user) return null;
  try {
    const result = readNotifications({page, limit});
    await result.refresh();
    const res = await result;
    if (res && getCurrentUser()?.id === user) {
      notifications = res.data;
      return res;
    }
  } catch {
    // handled by caller
  }
  return null;
}

export async function markAsRead(id: number) {
  await markNotificationRead(id);
  const wasUnread = notifications.some(notification => notification.id === id && !notification.is_read);
  notifications = notifications.map((n) =>
    n.id === id ? { ...n, is_read: true } : n
  );
  if (wasUnread) unreadCount = Math.max(0, unreadCount - 1);
}

export async function markAllAsRead() {
  await markAllNotificationsRead();
  notifications = notifications.map((n) => ({ ...n, is_read: true }));
  unreadCount = 0;
}

export function pushNotification(notification: any) {
  if (notification.type === 'message_received' || (notification.type === 'comment_added' && getCurrentUser()?.roles.includes('approver'))) return;
  if (notifications.some(existing => existing.id === notification.id)) return;
  notifications = [notification, ...notifications];
  unreadCount++;
}

export function startPolling(intervalMs = 30_000) {
  stopPolling();
  fetchUnreadCount();
  pollTimer = setInterval(fetchUnreadCount, intervalMs);
}

export function stopPolling() {
  unreadCount = 0;
  notifications = [];
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
