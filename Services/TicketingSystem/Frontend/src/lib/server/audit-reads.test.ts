import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrateDatabase } from './db/migrate';
import type { getDb } from './db';
import { auditLogs, ticketApprovers, tickets, users } from './db/schema';
import { readAudit, readTicketAuditTrail } from './audit-reads';
import { auditFilterSchema } from '../validation/audit';

let sqlite: Database;
let db: ReturnType<typeof getDb>;
let ids: number[];
let ticketId: number;
function expectStatus(run: () => unknown, status: number) {
  try { run(); } catch (error) { expect(error).toMatchObject({ status }); return; }
  throw new Error(`Expected HTTP ${status}`);
}
beforeEach(() => {
  sqlite = new Database(':memory:'); migrateDatabase(sqlite); db = drizzle(sqlite);
  ids = db.insert(users).values(['owner', 'other', 'approver'].map(username => ({ username, email: `${username}@example.com`, password: 'private', first_name: username, last_name: 'Test' }))).returning().all().map(row => row.id);
  ticketId = db.insert(tickets).values({ title: 'Ticket', description: 'Description', requester_id: ids[0] }).returning().get()!.id;
});
afterEach(() => sqlite.close());

test('audit filters separate auth from ticket history and paginate stable newest first', () => {
  db.insert(auditLogs).values([
    { action: 'user_login', performed_by_id: ids[0], created_at: new Date('2026-11-05T09:00:00Z') },
    { action: 'comment_added', ticket_id: ticketId, performed_by_id: ids[0], created_at: new Date('2026-11-05T09:00:00Z') },
    { action: 'status_change', ticket_id: ticketId, performed_by_id: ids[0], created_at: new Date('2026-11-05T09:01:00Z') },
    { action: 'status_change', ticket_id: ticketId, performed_by_id: ids[0], created_at: new Date('2026-11-05T09:01:00Z') },
  ]).run();
  const admin = { user: ids[1], roles: ['admin'] };
  const input = auditFilterSchema.parse({ limit: 1, action: 'status', exclude_action: 'comment_added' });
  const result = readAudit(db, admin, input, 'ticket');
  expect(result.pagination).toEqual({ page: 1, limit: 1, total: 2, pages: 2 });
  expect(result.data[0].created_at).toBe('2026-11-05T09:01:00.000Z');
  expect(result.data[0].performed_by).not.toHaveProperty('password');
  const page2 = readAudit(db, admin, { ...input, page: 2 }, 'ticket');
  expect(result.data[0].id).toBeGreaterThan(page2.data[0].id);
  expect(readAudit(db, admin, auditFilterSchema.parse({}), 'auth').data.map(row => row.action)).toEqual(['user_login']);
  expectStatus(() => readAudit(db, { user: ids[0], roles: ['user'] }, input, 'ticket'), 403);
  expect(auditFilterSchema.safeParse({ limit: 101 }).success).toBe(false);
});

test('ticket audit checks ticket membership and permits staff and assigned approvers', () => {
  db.insert(auditLogs).values({ action: 'created', ticket_id: ticketId, performed_by_id: ids[0] }).run();
  expect(readTicketAuditTrail(db, { user: ids[0], roles: ['user'] }, ticketId)).toHaveLength(1);
  expectStatus(() => readTicketAuditTrail(db, { user: ids[1], roles: ['user'] }, ticketId), 403);
  db.insert(ticketApprovers).values({ ticket_id: ticketId, approver_id: ids[2] }).run();
  expect(readTicketAuditTrail(db, { user: ids[2], roles: ['user'] }, ticketId)).toHaveLength(1);
  expect(readTicketAuditTrail(db, { user: ids[1], roles: ['mis'] }, ticketId)).toHaveLength(1);
  expectStatus(() => readTicketAuditTrail(db, { user: ids[0], roles: ['user'] }, 9999), 404);
});

test('audit history sorts mixed SQLite text and epoch timestamps chronologically', () => {
  const rows = db.insert(auditLogs).values([
    { action: 'older', ticket_id: ticketId, created_at: new Date('2026-11-05T09:00:00Z') },
    { action: 'newest', ticket_id: ticketId, created_at: new Date('2026-11-05T11:00:00Z') },
    { action: 'middle', ticket_id: ticketId, created_at: new Date('2026-11-05T10:00:00Z') },
  ]).returning().all();
  sqlite.query('UPDATE AuditLog SET created_at = ? WHERE id = ?').run(new Date('2026-11-05T11:00:00Z').getTime(), rows[1].id);
  sqlite.query('UPDATE AuditLog SET created_at = ? WHERE id = ?').run('2026-11-05 10:00:00', rows[2].id);
  const auth = { user: ids[0], roles: ['admin'] };
  expect(readAudit(db, auth, auditFilterSchema.parse({}), 'ticket').data.map(row => row.action)).toEqual(['newest', 'middle', 'older']);
  expect(readTicketAuditTrail(db, auth, ticketId).map(row => row.action)).toEqual(['newest', 'middle', 'older']);
});
