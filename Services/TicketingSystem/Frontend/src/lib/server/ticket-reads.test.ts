import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { migrateDatabase } from './db/migrate';
import type { getDb } from './db';
import * as s from './db/schema';
import { listPendingApprovals, listTicketApprovers, listTickets, readTicket, readTicketPreview } from './ticket-reads';
import { ticketListSchema } from '../validation/tickets';

let sqlite: Database;
let db: ReturnType<typeof getDb>;
const user = { user: 1, roles: ['user'] };
const staff = { user: 3, roles: ['mis'] };

function expectHttpError(operation: () => unknown, status: number) {
  try {
    operation();
    throw new Error('Expected HTTP error');
  } catch (error) {
    expect(error).toMatchObject({ status });
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  migrateDatabase(sqlite);
  db = drizzle(sqlite);
  for (const id of [1, 2, 3, 4]) {
    db.insert(s.users).values({ id, first_name: `First${id}`, last_name: 'Last', email: `${id}@example.com`, username: `user${id}`, password: 'must-never-be-returned' }).run();
    db.insert(s.userRoles).values({ user_id: id, role: id === 3 ? 'mis' : id === 4 ? 'approver' : 'user' }).run();
  }
  db.insert(s.tickets).values([
    { id: 1, title: 'Own ticket', description: 'Own details', requester_id: 1, created_at: new Date('2026-01-01T00:00:00Z') },
    { id: 2, title: 'Private ticket', description: 'Another owner', requester_id: 2, assignee_id: 3, created_at: new Date('2026-01-02T00:00:00Z') },
    { id: 3, title: '100% done', description: 'Literal search', requester_id: 1, due_date: new Date('2000-01-01T00:00:00Z'), created_at: new Date('2026-01-03T00:00:00Z') },
    { id: 4, title: '100X done', description: 'No wildcard', requester_id: 1, status: 'resolved', due_date: new Date('2000-01-01T00:00:00Z'), created_at: new Date('2026-01-04T00:00:00Z') },
  ]).run();
  db.insert(s.ticketApprovers).values({ ticket_id: 2, approver_id: 4 }).run();
  db.insert(s.ticketComments).values([
    { ticket_id: 1, user_id: 3, content: 'Public comment' },
    { ticket_id: 1, user_id: 3, content: 'Private internal note', is_internal: true },
  ]).run();
});
afterEach(() => sqlite.close());

test('ticket filters cannot override requester privacy or permit previews of another ticket', () => {
  const result = listTickets(db, user, ticketListSchema.parse({ requester_id: 2 }));
  expect(result.data).toEqual([]);
  expect(result.pagination.total).toBe(0);
  expectHttpError(() => readTicket(db, user, 2), 403);
  expectHttpError(() => readTicketPreview(db, user, 2), 403);
  expectHttpError(() => readTicket(db, staff, 999), 404);
  expect(readTicketPreview(db, { user: 4, roles: ['user'] }, 2)).toEqual({ id: 2, title: 'Private ticket' });
  expect(listTickets(db, staff, ticketListSchema.parse({})).pagination.total).toBe(4);
  expect(listTickets(db, staff, ticketListSchema.parse({ scope: 'assigned' })).data.map(t => t.id)).toEqual([2]);
  expect(listTickets(db, staff, ticketListSchema.parse({ scope: 'requested' })).data).toEqual([]);
});

test('details hide internal notes and all user password fields while preserving child data', () => {
  db.insert(s.attachments).values({ ticket_id: 1, file_name: 'original.png', file_url: '/uploads/original.png', mime_type: 'image/png' }).run();
  db.insert(s.resolutionAttempts).values({ ticket_id: 1, attempt_number: 1, handled_by_id: 3, resolved_at: new Date('2026-01-01T03:00:00Z') }).run();
  db.insert(s.auditLogs).values({ ticket_id: 1, performed_by_id: 3, action: 'fixture' }).run();
  db.insert(s.csat).values({ ticket_id: 1, rating: 5, agent_id: 3 }).run();
  const own = readTicket(db, user, 1);
  expect(own.comments!.map(c => c.content)).toEqual(['Public comment']);
  expect(Object.keys(own.comments![0].user!).sort()).toEqual(['id', 'first_name', 'last_name', 'username'].sort());
  expect(readTicket(db, staff, 1).comments).toHaveLength(2);
  expect(readTicket(db, { user: 4, roles: ['approver'] }, 1).comments).toHaveLength(2);
  expect(own.attachments![0].file_name).toBe('original.png');
  expect(own.resolution_attempts![0].resolved_at).toBe('2026-01-01T03:00:00.000Z');
  expect(own.audit_logs![0].performed_by!.username).toBe('user3');
  expect(own.csat!.rating).toBe(5);
  expect(JSON.stringify(own)).not.toContain('password');
  expect(JSON.stringify(own)).not.toContain('must-never-be-returned');
  expect(own.created_at).toBe('2026-01-01T00:00:00.000Z');
});

test('search, overdue, counts and pagination preserve list behavior', () => {
  const page = listTickets(db, staff, ticketListSchema.parse({ page: 2, limit: 2, sort: 'id', order: 'asc' }));
  expect(page.data.map(t => t.id)).toEqual([3, 4]);
  expect(page.pagination).toEqual({ page: 2, limit: 2, total: 4, pages: 2 });
  expect(listTickets(db, user, ticketListSchema.parse({ search: '100%' })).data.map(t => t.id)).toEqual([3]);
  expect(listTickets(db, user, ticketListSchema.parse({ overdue: 'true', status: 'resolved' })).data.map(t => t.id)).toEqual([3]);
  expect(db.select().from(s.tickets).where(eq(s.tickets.id, 3)).get()!.sla_breached).toBe(true);
  expect(db.select().from(s.tickets).where(eq(s.tickets.id, 4)).get()!.sla_breached).toBe(false);
  expect(ticketListSchema.safeParse({ sort: 'password' }).success).toBe(false);
  expect(ticketListSchema.safeParse({ limit: 101 }).success).toBe(false);
  expect(ticketListSchema.safeParse({ page: 0 }).success).toBe(false);
  expect(ticketListSchema.parse({ page: '2', limit: '10', assignee_id: '3' })).toMatchObject({ page: 2, limit: 10, assignee_id: 3 });
  expect(listTickets(db, user, ticketListSchema.parse({ unrated: 'true' })).data.map(t => t.id)).toEqual([4]);
  db.insert(s.csat).values({ ticket_id: 4, rating: 5 }).run();
  expect(listTickets(db, user, ticketListSchema.parse({ unrated: 'true' })).data).toEqual([]);
});

test('historical UTC and numeric epoch timestamps sort and filter chronologically', () => {
  sqlite.query('UPDATE Ticket SET created_at = ? WHERE id = 1').run('2026-01-05 00:00:00');
  sqlite.query('UPDATE Ticket SET created_at = ?, due_date = ? WHERE id = 2').run(new Date('2026-01-06T00:00:00Z').getTime(), new Date('2000-01-01T00:00:00Z').getTime());
  expect(listTickets(db, staff, ticketListSchema.parse({ sort: 'created_at', order: 'desc' })).data.map(t => t.id)).toEqual([2, 1, 4, 3]);
  expect(listTickets(db, staff, ticketListSchema.parse({ overdue: 'true', sort: 'id', order: 'asc' })).data.map(t => t.id)).toEqual([2, 3]);
});

test('approval lists check ticket membership and scope pending records to the current user', () => {
  expectHttpError(() => listTicketApprovers(db, user, 2), 403);
  expectHttpError(() => listTicketApprovers(db, { user: 4, roles: ['approver'] }, 1), 403);
  expect(listTicketApprovers(db, { user: 2, roles: ['user'] }, 2)[0].approver!.username).toBe('user4');
  const pending = listPendingApprovals(db, { user: 4, roles: ['approver'] });
  expect(pending.map(a => a.ticket_id)).toEqual([2]);
  expect(pending[0].ticket.requester!.username).toBe('user2');
  expect(JSON.stringify(pending)).not.toContain('password');
  expect(listPendingApprovals(db, user)).toEqual([]);
});
