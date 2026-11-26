import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { getDb } from './db';
import { readDashboardSummary, readTicketReport } from './report-reads';
import { dashboardQuerySchema, ticketReportQuerySchema } from '../validation/reports';
import { csat, departments, requestTypes, ticketApprovers, tickets, users } from './db/schema';

let sqlite: Database;
let db: ReturnType<typeof getDb>;
const now = new Date('2026-11-05T12:00:00Z');
const owner = { user: 1, roles: ['user'] };
const staff = { user: 3, roles: ['mis'] };
beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync(new URL('../../../drizzle/0000_existing_ticketing.sql', import.meta.url), 'utf8'));
  db = drizzle(sqlite);
  db.insert(departments).values([{ id: 1, name: 'IT' }, { id: 2, name: 'HR' }]).run();
  db.insert(requestTypes).values({ id: 1, name: 'Repair', department_id: 1 }).run();
  db.insert(users).values([
    { id: 1, username: 'owner', department_id: 1, last_active: now },
    { id: 2, username: 'other', department_id: 2, last_active: now },
    { id: 3, username: 'staff', department_id: 1, last_active: new Date(now.getTime() - 6 * 60_000) },
    { id: 4, username: 'inactive', is_active: false, last_active: now },
  ].map(row => ({ ...row, first_name: row.username, last_name: 'User', email: `${row.username}@example.com`, password: 'private-hash' }))).run();
  db.insert(tickets).values([
    { id: 1, requester_id: 1, title: 'Own open', department_id: 1, request_type_id: 1, priority: 'high', due_date: new Date(now.getTime() - 1000) },
    { id: 2, requester_id: 2, title: 'Other open', department_id: 1, priority: 'low' },
    { id: 3, requester_id: 1, title: 'Resolved', department_id: 2, status: 'resolved', started_at: new Date(now.getTime() - 4 * 3_600_000), completed_at: now, assignee_id: 3, sla_breached: true },
    { id: 4, requester_id: 1, title: 'Missing timing', department_id: 1, status: 'closed' },
    { id: 5, requester_id: 2, title: 'Pending approval', department_id: 2, status: 'pending_approval', assignee_id: 3 },
  ].map(row => ({ description: 'Fixture', created_at: now, ...row }))).run();
  db.insert(ticketApprovers).values({ ticket_id: 5, approver_id: 1 }).run();
  db.insert(csat).values({ ticket_id: 3, agent_id: 3, rating: 4 }).run();
});
afterEach(() => sqlite.close());

test('dashboard scopes counts, lists and distributions to requester and department', () => {
  const result = readDashboardSummary(db, owner, dashboardQuerySchema.parse({}), now);
  expect(result.stats).toEqual({ totalAll: 3, totalOpen: 1, totalInProgress: 0, totalResolved: 1, totalClosed: 1, totalOverdue: 1,
    totalAssignedToMe: 0, totalDepartmentUnassigned: 2, totalPendingApprovals: 1, totalUnrated: 1 });
  expect(result.tickets.every(ticket => ticket.requester_id === 1)).toBe(true);
  expect(result.unratedTickets.map(ticket => ticket.id)).toEqual([4]);
  expect(result.pendingApprovals).toEqual([]);
  expect(result.activeUsers.map(user => user.username)).toEqual(['other']);
  expect(JSON.stringify(result)).not.toContain('private-hash');
  expect(result.analytics.trends).toHaveLength(31);
  expect(result.analytics.trends.at(-1)).toEqual({ date: '2026-11-05', new: 3, resolved: 1 });
  expect(result.analytics.byType).toContainEqual({ name: 'Repair', count: 1 });
  expect(result.analytics.byPriority).toContainEqual({ name: 'High', count: 1 });
  const department = readDashboardSummary(db, owner, dashboardQuerySchema.parse({ department_id: 1 }), now);
  expect(department.tickets.map(ticket => ticket.id).sort()).toEqual([1, 4]);
  expect(department.stats.totalAll).toBe(2);
  expect(department.stats.totalUnrated).toBe(1);
});

test('staff sees all dashboard tickets and approvers see only their pending decisions', () => {
  expect(readDashboardSummary(db, staff, dashboardQuerySchema.parse({}), now).stats.totalAll).toBe(5);
  const approver = readDashboardSummary(db, { ...owner, roles: ['approver'] }, dashboardQuerySchema.parse({}), now);
  expect(approver.stats.totalAll).toBe(5);
  expect(approver.pendingApprovals.map(approval => approval.ticket.id)).toEqual([5]);
  expect(approver.pendingApprovals[0].created_at).toBeTypeOf('string');
});

test('reports enforce staff access, preserve aggregates and handle nullable relations', () => {
  expect(() => readTicketReport(db, owner, {})).toThrow();
  expect(() => readTicketReport(db, { ...owner, roles: ['approver'] }, {})).toThrow();
  const result = readTicketReport(db, staff, {});
  expect(result.summary).toEqual({ total: 5, resolved: 2, sla_breached: 1, sla_compliance_rate: 80,
    avg_resolution_time_ms: 2 * 3_600_000, avg_csat_rating: 4 });
  const ticket = result.tickets.find(ticket => ticket.id === 3)!;
  expect(ticket.requester.department?.name).toBe('IT');
  expect(ticket.assignee?.username).toBe('staff');
  expect(ticket.request_type).toBeNull();
  expect(ticket.completed_at).toBe(now.toISOString());
  expect(ticket.csat?.submitted_at).toBeTypeOf('string');
  expect(JSON.stringify(result)).not.toContain('private-hash');
  expect(readTicketReport(db, staff, { requester_id: 2, status: 'open' }).tickets.map(ticket => ticket.id)).toEqual([2]);
  expect(readTicketReport(db, staff, { department_id: 99 }).summary).toEqual({ total: 0, resolved: 0, sla_breached: 0,
    sla_compliance_rate: 100, avg_resolution_time_ms: 0, avg_csat_rating: 0 });
});

test('reports and dashboard compare historical text and epoch dates chronologically', () => {
  sqlite.query('UPDATE Ticket SET created_at = ? WHERE id = 1').run('2026-11-05 11:00:00');
  sqlite.query('UPDATE Ticket SET created_at = ? WHERE id = 2').run(now.getTime());
  sqlite.query('UPDATE Ticket SET created_at = ? WHERE id = 3').run('2026-11-05T11:30:00+00:00');
  const report = readTicketReport(db, staff, { date_from: '2026-11-05T11:30:00Z', date_to: now.toISOString() });
  expect(report.tickets.map(ticket => ticket.id).sort()).toEqual([2, 3, 4, 5]);
  const dashboard = readDashboardSummary(db, staff, dashboardQuerySchema.parse({ sort: 'created_at', order: 'asc' }), now);
  expect(dashboard.tickets.slice(0, 2).map(ticket => ticket.id)).toEqual([1, 3]);
});

test('query schemas reject invalid dates, inverted ranges and unsafe sort names', () => {
  expect(ticketReportQuerySchema.safeParse({ date_from: 'invalid' }).success).toBe(false);
  expect(ticketReportQuerySchema.safeParse({ date_from: '2026-11-06', date_to: '2026-11-05' }).success).toBe(false);
  expect(ticketReportQuerySchema.safeParse({ requester_id: -1 }).success).toBe(false);
  expect(dashboardQuerySchema.safeParse({ sort: 'password' }).success).toBe(false);
});
