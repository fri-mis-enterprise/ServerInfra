import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import type { getDb } from './db';
import { migrateDatabase } from './db/migrate';
import { messages, notifications, tickets, users } from './db/schema';
import { markMessagesRead, readConversations, readMessages, sendMessage, unreadMessages } from './messages';
import { sendMessageSchema } from '../validation/messages';
let sqlite: Database, db: ReturnType<typeof getDb>;
const auth = (user: number) => ({ user, roles: ['user'] });
beforeEach(() => {
  sqlite = new Database(':memory:'); migrateDatabase(sqlite); db = drizzle(sqlite);
  db.insert(users).values(['one', 'two', 'three'].map(username => ({ username, email: `${username}@example.com`, first_name: username, last_name: 'Test', password: 'secret' }))).run();
});
afterEach(() => sqlite.close());
test('messages and read receipts are limited to the current participants', () => {
  const first = sendMessage(db, auth(1), { receiver_id: 2, content: 'Hello' });
  sendMessage(db, auth(3), { receiver_id: 2, content: 'Other conversation' });
  expect(first.notifications).toHaveLength(1);
  expect(db.select().from(notifications).all()).toHaveLength(2);
  expect(readMessages(db, auth(1), 2).map(row => row.content)).toEqual(['Hello']);
  expect(readMessages(db, auth(3), 1)).toEqual([]);
  expect(unreadMessages(db, auth(2)).count).toBe(2);
  markMessagesRead(db, auth(2), 1);
  expect(unreadMessages(db, auth(2)).count).toBe(1);
  expect(db.select().from(messages).where(eq(messages.sender_id, 3)).get()!.is_read).toBe(false);
  expect(JSON.stringify(readConversations(db, auth(2)))).not.toContain('password');
  expect(readConversations(db, auth(1)).map(row => row.id)).toEqual([2]);
});
test('inactive recipients and unauthorized ticket references cannot create messages', () => {
  db.update(users).set({ is_active: false }).where(eq(users.id, 3)).run();
  expect(() => sendMessage(db, auth(1), { receiver_id: 3, content: 'No' })).toThrow();
  db.insert(tickets).values({ title: 'Secret ticket', description: 'Description', requester_id: 3 }).run();
  expect(() => sendMessage(db, auth(1), { receiver_id: 2, content: 'No', ticket_id: 1 })).toThrow();
  expect(db.select().from(messages).all()).toEqual([]);
  expect(sendMessageSchema.safeParse({ receiver_id: 2, content: '   ' }).success).toBe(false);
});
test('ticket previews in a conversation do not disclose titles to unrelated recipients', () => {
  db.insert(tickets).values({ title: 'Secret ticket', description: 'Description', requester_id: 1 }).run();
  sendMessage(db, auth(1), { receiver_id: 2, content: 'Reference', ticket_id: 1 });
  expect(readMessages(db, auth(2), 1)[0].ticket).toBeNull();
  expect(readMessages(db, auth(1), 2)[0].ticket?.title).toBe('Secret ticket');
  expect(JSON.stringify(readConversations(db, auth(2)))).not.toContain('Secret ticket');
});
