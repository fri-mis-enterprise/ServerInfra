import { error } from '@sveltejs/kit';
import { and, count, desc, eq, notInArray } from 'drizzle-orm';
import webpush from 'web-push';
import type { z } from 'zod';
import type { AuthContext } from './auth';
import { getDb } from './db';
import { notifications, pushSubscriptions, tickets, users } from './db/schema';
import { sqliteDateMillis } from './db/date';
import { broadcaster } from './realtime';
import type { notificationListSchema, pushSubscriptionSchema } from '../validation/notifications';

type Db = Pick<ReturnType<typeof getDb>, 'select' | 'insert' | 'update' | 'delete'>;
type ExtraData = { sender_id?: number };
export type QueuedNotification = typeof notifications.$inferSelect & { extraData?: ExtraData };
export function queueNotification(db: Pick<Db, 'insert' | 'select'>, userId: number, ticketId: number | null, type: string, message: string, extraData?: ExtraData): QueuedNotification {
  const ticket = ticketId === null ? null : db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticketId)).get();
  return { ...db.insert(notifications).values({ user_id: userId, ticket_id: ticket?.id ?? null, type, message }).returning().get()!, extraData };
}
const dto = (row: typeof notifications.$inferSelect) => ({ ...row, created_at: row.created_at.toISOString(), read_at: row.read_at?.toISOString() });
export function notificationPayload(row: QueuedNotification) {
  const message = row.type === 'message_received';
  const url = message && row.extraData?.sender_id ? `/messages/${row.extraData.sender_id}` : row.ticket_id ? `/tickets/${row.ticket_id}` : '/notifications';
  const titles: Record<string, string> = { message_received: 'New Message', approval_requested: `Approval Required #${row.ticket_id}`, ticket_created: `New Ticket #${row.ticket_id}`, comment_added: `New Comment #${row.ticket_id}`, escalated: `Ticket Escalated #${row.ticket_id}`, status_updated: `Ticket Status Changed #${row.ticket_id}` };
  return { title: titles[row.type] || 'New Notification', body: row.message, url, type: row.type, tag: row.ticket_id ? `ticket-${row.ticket_id}` : message && row.extraData?.sender_id ? `message-${row.extraData.sender_id}` : row.type };
}
export async function deliverNotifications(rows: QueuedNotification[]) {
  await Promise.all(rows.map(async row => {
    try {
      const { extraData: _, ...notification } = row;
      broadcaster.notifyUser(row.user_id, dto(notification));
      const db = getDb();
      const receiver = db.select({ active: users.is_active, messages: users.message_notifications }).from(users).where(eq(users.id, row.user_id)).get();
      if (!receiver?.active || (row.type === 'message_received' && !receiver.messages)) return;
      const publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY, subject = process.env.VAPID_CONTACT;
      if (!publicKey || !privateKey || !subject) return;
      await Promise.all(db.select().from(pushSubscriptions).where(eq(pushSubscriptions.user_id, row.user_id)).all().map(async subscription => {
        if (!isSupportedPushEndpoint(subscription.endpoint)) return;
        try {
          await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(notificationPayload(row)), { vapidDetails: { publicKey, privateKey, subject }, timeout: 10_000 });
        } catch (failure) {
          const status = (failure as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, subscription.id), eq(pushSubscriptions.user_id, row.user_id))).run();
          else console.error('Web push delivery failed', status ?? 'network error');
        }
      }));
    } catch { console.error('Notification delivery failed after commit'); }
  }));
}
function visible(auth: AuthContext) {
  return and(eq(notifications.user_id, auth.user), notInArray(notifications.type, auth.roles.includes('approver') ? ['message_received', 'comment_added'] : ['message_received']));
}
export function readNotifications(db: Db, auth: AuthContext, input: z.output<typeof notificationListSchema>) {
  const where = and(visible(auth), input.unread_only === 'true' ? eq(notifications.is_read, false) : undefined);
  const data = db.select({ notification: notifications, ticket: { id: tickets.id, title: tickets.title, status: tickets.status } }).from(notifications).leftJoin(tickets, eq(tickets.id, notifications.ticket_id)).where(where).orderBy(desc(sqliteDateMillis(notifications.created_at)), desc(notifications.id)).limit(input.limit).offset((input.page - 1) * input.limit).all().map(({ notification, ticket }) => ({ ...dto(notification), ticket }));
  const total = db.select({ value: count() }).from(notifications).where(where).get()!.value;
  return { data, pagination: { page: input.page, limit: input.limit, total, pages: Math.ceil(total / input.limit) } };
}
export function unreadNotifications(db: Db, auth: AuthContext) { return { count: db.select({ value: count() }).from(notifications).where(and(visible(auth), eq(notifications.is_read, false))).get()!.value }; }
export function markNotificationRead(db: Db, auth: AuthContext, id: number) {
  if (!db.update(notifications).set({ is_read: true, read_at: new Date() }).where(and(eq(notifications.id, id), eq(notifications.user_id, auth.user))).returning({ id: notifications.id }).get()) error(404, 'Notification not found');
}
export function markAllNotificationsRead(db: Db, auth: AuthContext) { db.update(notifications).set({ is_read: true, read_at: new Date() }).where(and(eq(notifications.user_id, auth.user), eq(notifications.is_read, false))).run(); }
export function deleteNotification(db: Db, auth: AuthContext, id: number) {
  if (!db.delete(notifications).where(and(eq(notifications.id, id), eq(notifications.user_id, auth.user))).returning({ id: notifications.id }).get()) error(404, 'Notification not found');
}
export function subscribePush(db: Db, auth: AuthContext, input: z.output<typeof pushSubscriptionSchema>) {
  if (!isSupportedPushEndpoint(input.endpoint)) error(400, 'Unsupported push service');
  const existing = db.select({ user: pushSubscriptions.user_id }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, input.endpoint)).get();
  if (existing && existing.user !== auth.user) error(409, 'This push subscription belongs to another account');
  const inserted = db.insert(pushSubscriptions).values({ user_id: auth.user, endpoint: input.endpoint, ...input.keys }).onConflictDoNothing().returning({ id: pushSubscriptions.id }).get();
  if (!inserted) {
    const updated = db.update(pushSubscriptions).set({ ...input.keys }).where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.user_id, auth.user))).returning({ id: pushSubscriptions.id }).get();
    if (!updated) error(409, 'This push subscription belongs to another account');
  }
  return { message: 'Subscribed successfully' };
}
function isSupportedPushEndpoint(value: string) {
  let endpoint: URL;
  try { endpoint = new URL(value); } catch { return false; }
  const allowed = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com', 'wns.windows.com'];
  return endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && (!endpoint.port || endpoint.port === '443') && allowed.some(host => endpoint.hostname === host || endpoint.hostname.endsWith(`.${host}`));
}
export function unsubscribePush(db: Db, auth: AuthContext, endpoint: string) { db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.user_id, auth.user), eq(pushSubscriptions.endpoint, endpoint))).run(); }
