import { error } from '@sveltejs/kit';
import { and, count, desc, eq, getTableColumns, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { auditFilterSchema } from '../validation/audit';
import type { AuthContext } from './auth';
import type { getDb } from './db';
import { auditLogs, ticketApprovers, tickets, users } from './db/schema';
import { sqliteDateMillis } from './db/date';
import { redactCommentAudit } from './audit-privacy';

type Db = ReturnType<typeof getDb>;
type Filters = z.infer<typeof auditFilterSchema>;
const actor = { id: users.id, first_name: users.first_name, last_name: users.last_name, username: users.username };
const columns = { ...getTableColumns(auditLogs), performed_by: actor };
function staff(auth: AuthContext) {
  if (!auth.roles.some(role => role === 'admin' || role === 'mis')) error(403, 'Access denied');
}

export function readAudit(db: Db, auth: AuthContext, input: Filters, kind: 'ticket' | 'auth') {
  staff(auth);
  const where = and(kind === 'auth' ? isNull(auditLogs.ticket_id) : isNotNull(auditLogs.ticket_id),
    kind === 'ticket' && input.ticket_id ? eq(auditLogs.ticket_id, input.ticket_id) : undefined,
    input.performed_by_id ? eq(auditLogs.performed_by_id, input.performed_by_id) : undefined,
    // Prisma's old exclude filter replaced action; combining both keeps the requested scope.
    input.action ? sql`instr(lower(${auditLogs.action}), lower(${input.action})) > 0` : undefined,
    input.exclude_action ? ne(auditLogs.action, input.exclude_action) : undefined);
  const rows = db.select({ ...columns, ticket: { id: tickets.id, title: tickets.title, status: tickets.status } })
    .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.performed_by_id)).leftJoin(tickets, eq(tickets.id, auditLogs.ticket_id))
    .where(where).orderBy(desc(sqliteDateMillis(auditLogs.created_at)), desc(auditLogs.id)).limit(input.limit).offset((input.page - 1) * input.limit).all();
  const total = db.select({ value: count() }).from(auditLogs).where(where).get()!.value;
  return {
    data: rows.map(row => ({ ...row, created_at: row.created_at.toISOString() })),
    pagination: { page: input.page, limit: input.limit, total, pages: Math.ceil(total / input.limit) },
  };
}

export function readTicketAuditTrail(db: Db, auth: AuthContext, ticketId: number) {
  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
  if (!ticket) error(404, 'Ticket not found');
  const assignedApprover = db.select({ id: ticketApprovers.id }).from(ticketApprovers)
    .where(and(eq(ticketApprovers.ticket_id, ticketId), eq(ticketApprovers.approver_id, auth.user))).get();
  if (!auth.roles.some(role => ['admin', 'mis', 'approver'].includes(role)) && ticket.requester_id !== auth.user && ticket.assignee_id !== auth.user && !assignedApprover) error(403, 'Access denied');
  return db.select(columns).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.performed_by_id))
    .where(eq(auditLogs.ticket_id, ticketId)).orderBy(desc(sqliteDateMillis(auditLogs.created_at)), desc(auditLogs.id)).all()
    .map(row => redactCommentAudit(row, auth.roles.some(role => ['admin', 'mis', 'approver'].includes(role))))
    .map(row => ({ ...row, created_at: row.created_at.toISOString() }));
}
