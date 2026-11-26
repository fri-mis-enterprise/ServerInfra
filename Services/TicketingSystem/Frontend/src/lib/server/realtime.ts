import { and, eq } from 'drizzle-orm';
import type { getDb } from './db';
import { ticketApprovers, tickets, userRoles, users } from './db/schema';

type Db = Pick<ReturnType<typeof getDb>, 'select' | 'update'>;
type Envelope = { type: string; payload: unknown };
type Audience = { user?: number; role?: string; ticket?: number; internal?: boolean };
type Subscriber = { db: Db; user: number; expiresAt: number; tickets: Set<number>; send: (event: Envelope) => void; close: () => void };
const subscribers = new Set<Subscriber>();

export function currentRoles(db: Db, user: number, expiresAt: number, now = Date.now()) {
  if (now >= expiresAt || !db.select({ active: users.is_active }).from(users).where(eq(users.id, user)).get()?.active) return null;
  return db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.user_id, user)).all().map(row => row.role);
}

export function canReadTicket(db: Pick<Db, 'select'>, user: number, roles: string[], ticket: number) {
  const row = db.select({ requester: tickets.requester_id, assignee: tickets.assignee_id }).from(tickets).where(eq(tickets.id, ticket)).get();
  if (!row) return false;
  return roles.some(role => ['admin', 'mis', 'approver'].includes(role)) || row.requester === user || row.assignee === user || !!db.select({ id: ticketApprovers.id }).from(ticketApprovers).where(and(eq(ticketApprovers.ticket_id, ticket), eq(ticketApprovers.approver_id, user))).get();
}

export function subscribeEvents(subscriber: Subscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function publish(audience: Audience, type: string, payload: unknown) {
  for (const subscriber of subscribers) {
    try {
      const roles = currentRoles(subscriber.db, subscriber.user, subscriber.expiresAt);
      if (!roles) { subscribers.delete(subscriber); subscriber.close(); continue; }
      if (audience.user !== undefined && audience.user !== subscriber.user) continue;
      if (audience.role && !roles.includes(audience.role)) continue;
      if (audience.ticket !== undefined && (!subscriber.tickets.has(audience.ticket) || !canReadTicket(subscriber.db, subscriber.user, roles, audience.ticket))) continue;
      if (audience.internal && !roles.some(role => ['admin', 'mis', 'approver'].includes(role))) continue;
      subscriber.send({ type, payload });
    } catch {
      subscribers.delete(subscriber);
      try { subscriber.close(); } catch { /* the disconnected client is already gone */ }
    }
  }
}

export const broadcaster = {
  notifyUser: (user: number, notification: unknown) => publish({ user }, 'notification', notification),
  ticketUpdated: (ticket: number, data: object) => publish({ ticket }, 'ticket_updated', { ticket_id: ticket, ...data }),
  commentAdded: (ticket: number, comment: unknown) => publish({ ticket }, 'comment_added', { ticket_id: ticket, comment }),
  internalNoteAdded: (ticket: number, comment: unknown) => publish({ ticket, internal: true }, 'comment_added', { ticket_id: ticket, comment }),
  messageSent: (user: number, message: unknown) => publish({ user }, 'message_received', message),
  messagesRead: (user: number, reader: number, ticket?: number | null) => publish({ user }, 'messages_read', { reader_id: reader, ticket_id: ticket }),
  notifyMIS: (type: string, payload: unknown) => publish({ role: 'mis' }, type, payload),
  notifyAdmins: (type: string, payload: unknown) => publish({ role: 'admin' }, type, payload),
};
