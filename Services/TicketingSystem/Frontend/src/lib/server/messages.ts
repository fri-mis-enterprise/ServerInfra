import { error } from '@sveltejs/kit';
import { and, asc, count, desc, eq, ne, or } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthContext } from './auth';
import type { getDb } from './db';
import { messages, tickets, users } from './db/schema';
import { sqliteDateMillis } from './db/date';
import { readUserDirectory } from './user-reads';
import { broadcaster, canReadTicket } from './realtime';
import { queueNotification, type QueuedNotification } from './notifications';
import type { sendMessageSchema } from '../validation/messages';

type Db = ReturnType<typeof getDb>;
const exchanged = (self: number, contact: number) => or(and(eq(messages.sender_id, self), eq(messages.receiver_id, contact)), and(eq(messages.sender_id, contact), eq(messages.receiver_id, self)));
function messageDto(db: Pick<Db, 'select'>, row: typeof messages.$inferSelect, auth: AuthContext) {
  const sender = db.select({ id: users.id, first_name: users.first_name, last_name: users.last_name, username: users.username }).from(users).where(eq(users.id, row.sender_id)).get();
  const ticket = row.ticket_id && canReadTicket(db, auth.user, auth.roles, row.ticket_id) ? db.select({ id: tickets.id, title: tickets.title, status: tickets.status }).from(tickets).where(eq(tickets.id, row.ticket_id)).get() : null;
  return { ...row, created_at: row.created_at.toISOString(), sender, ticket };
}
export function unreadMessages(db: Db, auth: AuthContext) { return { count: db.select({ value: count() }).from(messages).where(and(eq(messages.receiver_id, auth.user), ne(messages.sender_id, auth.user), eq(messages.is_read, false))).get()!.value }; }
export function readMessages(db: Db, auth: AuthContext, contact: number) { return db.select().from(messages).where(exchanged(auth.user, contact)).orderBy(asc(sqliteDateMillis(messages.created_at)), asc(messages.id)).all().map(row => messageDto(db, row, auth)); }
export function markMessagesRead(db: Db, auth: AuthContext, contact: number) {
  const changed = db.update(messages).set({ is_read: true }).where(and(eq(messages.sender_id, contact), eq(messages.receiver_id, auth.user), eq(messages.is_read, false))).returning({ id: messages.id }).all();
  if (changed.length) broadcaster.messagesRead(contact, auth.user);
}
export function readConversations(db: Db, auth: AuthContext) {
  const exchanges = db.select().from(messages).where(or(eq(messages.sender_id, auth.user), eq(messages.receiver_id, auth.user))).orderBy(desc(sqliteDateMillis(messages.created_at)), desc(messages.id)).all();
  const seen = new Set<number>();
  return exchanges.flatMap(row => {
    const contactId = row.sender_id === auth.user ? row.receiver_id : row.sender_id;
    if (contactId === auth.user || seen.has(contactId)) return [];
    seen.add(contactId);
    const contact = db.select({ id: users.id, first_name: users.first_name, last_name: users.last_name, username: users.username, last_active: users.last_active }).from(users).where(eq(users.id, contactId)).get();
    return contact ? [{ ...contact, last_active: contact.last_active?.toISOString(), last_message: messageDto(db, row, auth) }] : [];
  });
}
export function readContact(db: Db, id: number) {
  const contact = readUserDirectory(db).find(row => row.id === id);
  if (!contact) error(404, 'Contact not found');
  return contact;
}
export function searchContacts(db: Db, query: string) {
  if (query.length < 2) return [];
  const normalized = query.toLowerCase();
  return readUserDirectory(db).filter(row => [row.first_name, row.last_name, row.username].some(value => value.toLowerCase().includes(normalized))).slice(0, 10);
}
export function sendMessage(db: Db, auth: AuthContext, input: z.output<typeof sendMessageSchema>) {
  const receiver = db.select({ id: users.id, active: users.is_active, notify: users.message_notifications }).from(users).where(eq(users.id, input.receiver_id)).get();
  if (!receiver?.active) error(400, 'Recipient is not active');
  if (input.ticket_id && !canReadTicket(db, auth.user, auth.roles, input.ticket_id)) error(403, 'Access denied to linked ticket');
  const result = db.transaction(tx => {
    const row = tx.insert(messages).values({ sender_id: auth.user, receiver_id: input.receiver_id, content: input.content, ticket_id: input.ticket_id }).returning().get()!;
    const dto = messageDto(tx, row, auth);
    const notifications: QueuedNotification[] = [];
    if (receiver.notify) notifications.push(queueNotification(tx, receiver.id, null, 'message_received', `Message from ${dto.sender?.first_name ?? 'User'}: ${input.content.slice(0, 50)}${input.content.length > 50 ? '...' : ''}`, { sender_id: auth.user }));
    return { message: dto, notifications };
  });
  const { ticket: _, ...event } = result.message;
  broadcaster.messageSent(input.receiver_id, event);
  return result;
}
