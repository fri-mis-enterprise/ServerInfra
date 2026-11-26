import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { getDb } from './db';
import { migrateDatabase } from './db/migrate';
import { pushSubscriptions, users } from './db/schema';
import { deleteNotification, markNotificationRead, notificationPayload, queueNotification, readNotifications, subscribePush, unreadNotifications, unsubscribePush } from './notifications';
import { notificationListSchema, pushSubscriptionSchema } from '../validation/notifications';
let sqlite: Database, db: ReturnType<typeof getDb>;
const one = { user: 1, roles: ['user'] }, two = { user: 2, roles: ['approver'] };
beforeEach(() => {
  sqlite = new Database(':memory:'); migrateDatabase(sqlite); db = drizzle(sqlite);
  db.insert(users).values(['one', 'two'].map(username => ({ username, email: `${username}@example.com`, first_name: username, last_name: 'Test', password: 'secret' }))).run();
});
afterEach(() => sqlite.close());
test('notifications stay user scoped and list/count exclusions match', () => {
  const own = queueNotification(db, 1, null, 'ticket_created', 'One');
  queueNotification(db, 1, null, 'message_received', 'Message');
  queueNotification(db, 2, null, 'comment_added', 'Hidden from approver');
  queueNotification(db, 2, null, 'ticket_created', 'Two');
  expect(readNotifications(db, one, notificationListSchema.parse({})).pagination.total).toBe(1);
  expect(unreadNotifications(db, one).count).toBe(1);
  expect(unreadNotifications(db, two).count).toBe(1);
  expect(() => markNotificationRead(db, two, own.id)).toThrow();
  expect(() => deleteNotification(db, two, own.id)).toThrow();
  markNotificationRead(db, one, own.id);
  expect(unreadNotifications(db, one).count).toBe(0);
});
test('push endpoint ownership cannot transfer and unsubscribe affects only its owner', () => {
  const input = pushSubscriptionSchema.parse({ endpoint: 'https://fcm.googleapis.com/send/example', keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } });
  subscribePush(db, one, input);
  expect(() => subscribePush(db, two, input)).toThrow();
  unsubscribePush(db, two, input.endpoint);
  expect(db.select().from(pushSubscriptions).all()).toHaveLength(1);
  unsubscribePush(db, one, input.endpoint);
  expect(db.select().from(pushSubscriptions).all()).toHaveLength(0);
  expect(() => subscribePush(db, one, { ...input, endpoint: 'https://127.0.0.1/private' })).toThrow();
});
test('message push payloads navigate to the sender while stale tickets do not break inserts', () => {
  const row = queueNotification(db, 1, 9999, 'message_received', 'New message', { sender_id: 2 });
  expect(row.ticket_id).toBeNull();
  expect(notificationPayload(row)).toMatchObject({ url: '/messages/2', tag: 'message-2', title: 'New Message' });
});
