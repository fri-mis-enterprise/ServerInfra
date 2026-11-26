import { error } from '@sveltejs/kit';
import { and, asc, count, desc, eq, getTableColumns, notInArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AuthContext } from './auth';
import type { getDb } from './db';
import * as s from './db/schema';
import { sqliteDateMillis } from './db/date';
import { redactCommentAudit } from './audit-privacy';
import { sanitizeRichText } from './rich-text';
import type { ApprovalStatus, AttachmentType, Ticket, TicketPriority, TicketStatus, User } from '../types';
import type { TicketListInput } from '../validation/tickets';

type Db = ReturnType<typeof getDb>;
type TicketRow = typeof s.tickets.$inferSelect;

export function loadUser(db: Pick<Db, 'select'>, id: number | null): User | undefined {
  if (id === null) return undefined;
  const { password: _, ...columns } = getTableColumns(s.users);
  const row = db.select(columns).from(s.users).where(eq(s.users.id, id)).get();
  if (!row) return undefined;
  return {
    ...row, position: row.position ?? undefined, department_id: row.department_id ?? undefined,
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(), last_active: row.last_active?.toISOString(),
    roles: db.select({ role: s.userRoles.role }).from(s.userRoles).where(eq(s.userRoles.user_id, id)).all().map(r => r.role),
    department: row.department_id === null ? undefined : db.select().from(s.departments).where(eq(s.departments.id, row.department_id)).get(),
  };
}

function childCount(db: Db, table: typeof s.attachments | typeof s.resolutionAttempts, ticketId: number) {
  return db.select({ total: count() }).from(table).where(eq(table.ticket_id, ticketId)).get()!.total;
}

export function ticketDto(db: Db, row: TicketRow): Ticket & { _count: { attachments: number; resolution_attempts: number } } {
  return {
    ...row,
    description: sanitizeRichText(row.description),
    status: row.status as TicketStatus, priority: row.priority as TicketPriority,
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(),
    escalated_at: row.escalated_at?.toISOString(), started_at: row.started_at?.toISOString(),
    completed_at: row.completed_at?.toISOString(), due_date: row.due_date?.toISOString(), breached_at: row.breached_at?.toISOString(),
    escalated_by_id: row.escalated_by_id ?? undefined, assignee_id: row.assignee_id ?? undefined,
    request_type_id: row.request_type_id ?? undefined, affected_system_id: row.affected_system_id ?? undefined,
    requester: loadUser(db, row.requester_id), assignee: loadUser(db, row.assignee_id),
    request_type: row.request_type_id === null ? undefined : db.select().from(s.requestTypes).where(eq(s.requestTypes.id, row.request_type_id)).get(),
    affected_system: row.affected_system_id === null ? undefined : db.select().from(s.affectedSystems).where(eq(s.affectedSystems.id, row.affected_system_id)).get(),
    _count: { attachments: childCount(db, s.attachments, row.id), resolution_attempts: childCount(db, s.resolutionAttempts, row.id) },
  };
}

const isStaff = (auth: AuthContext) => auth.roles.some(role => ['admin', 'mis', 'approver'].includes(role));

function accessibleTicket(db: Db, auth: AuthContext, id: number, allowUnassignedApproverRole = true) {
  const row = db.select().from(s.tickets).where(eq(s.tickets.id, id)).get();
  if (!row) error(404, 'Ticket not found');
  const staff = allowUnassignedApproverRole ? isStaff(auth) : auth.roles.some(role => ['admin', 'mis'].includes(role));
  const approver = db.select({ id: s.ticketApprovers.id }).from(s.ticketApprovers)
    .where(and(eq(s.ticketApprovers.ticket_id, id), eq(s.ticketApprovers.approver_id, auth.user))).get();
  if (!staff && row.requester_id !== auth.user && row.assignee_id !== auth.user && !approver) error(403, 'Access denied');
  return row;
}

export function listTickets(db: Db, auth: AuthContext, input: TicketListInput) {
  const conditions: (SQL | undefined)[] = [];
  if (input.scope === 'requested') conditions.push(eq(s.tickets.requester_id, auth.user));
  else if (input.scope === 'assigned') conditions.push(eq(s.tickets.assignee_id, auth.user));
  else if (!isStaff(auth)) conditions.push(eq(s.tickets.requester_id, auth.user));
  for (const key of ['assignee_id', 'requester_id', 'department_id', 'affected_system_id', 'request_type_id'] as const) {
    if (input[key] !== undefined) conditions.push(eq(s.tickets[key], input[key]));
  }
  if (input.priority) conditions.push(eq(s.tickets.priority, input.priority));
  if (input.search) {
    // LIKE wildcards in user input must match literal characters, as Prisma contains does.
    const escaped = input.search.replace(/[!%_]/g, '!$&');
    conditions.push(sql`(${s.tickets.title} LIKE ${`%${escaped}%`} ESCAPE '!' OR ${s.tickets.description} LIKE ${`%${escaped}%`} ESCAPE '!')`);
  }
  const overdue = and(sql`${sqliteDateMillis(s.tickets.due_date)} <= ${Date.now()}`, notInArray(s.tickets.status, ['resolved', 'closed']));
  if (input.overdue === 'true') conditions.push(overdue);
  else if (input.status) conditions.push(eq(s.tickets.status, input.status));
  if (input.unrated === 'true') {
    conditions.push(eq(s.tickets.requester_id, auth.user), sql`${s.tickets.status} IN ('resolved', 'closed')`,
      sql`NOT EXISTS (SELECT 1 FROM ${s.csat} WHERE ${s.csat.ticket_id} = ${s.tickets.id})`);
  }
  if (input.scope === 'all') {
    db.update(s.tickets).set({ sla_breached: true, breached_at: new Date() }).where(and(overdue, eq(s.tickets.sla_breached, false))).run();
  }
  const where = and(...conditions);
  const sortColumn = ['created_at', 'updated_at', 'due_date'].includes(input.sort)
    ? sqliteDateMillis(s.tickets[input.sort as 'created_at' | 'updated_at' | 'due_date']) : s.tickets[input.sort];
  const order = input.order === 'asc' ? asc : desc;
  const rows = db.select().from(s.tickets).where(where).orderBy(order(sortColumn), order(s.tickets.id)).limit(input.limit).offset((input.page - 1) * input.limit).all();
  const total = db.select({ total: count() }).from(s.tickets).where(where).get()!.total;
  return { data: rows.map(row => ticketDto(db, row)), pagination: { page: input.page, limit: input.limit, total, pages: Math.ceil(total / input.limit) } };
}

function approverDtos(db: Db, ticketId: number) {
  return db.select().from(s.ticketApprovers).where(eq(s.ticketApprovers.ticket_id, ticketId)).all().map(row => ({
    ...row, status: row.status as ApprovalStatus, remarks: row.remarks ?? undefined,
    created_at: row.created_at.toISOString(), decided_at: row.decided_at?.toISOString(), approver: loadUser(db, row.approver_id),
  }));
}

export function listTicketApprovers(db: Db, auth: AuthContext, ticketId: number) {
  accessibleTicket(db, auth, ticketId, false);
  return approverDtos(db, ticketId);
}

export function readTicketPreview(db: Db, auth: AuthContext, id: number) {
  const row = accessibleTicket(db, auth, id);
  return { id: row.id, title: row.title };
}

export function readTicket(db: Db, auth: AuthContext, id: number): Ticket {
  const row = accessibleTicket(db, auth, id);
  const customerSurvey = db.select().from(s.csat).where(eq(s.csat.ticket_id, id)).get();
  return {
    ...ticketDto(db, row),
    department: row.department_id === null ? undefined : db.select().from(s.departments).where(eq(s.departments.id, row.department_id)).get(),
    hardware_item: row.hardware_item_id === null ? undefined : db.select().from(s.hardwareItems).where(eq(s.hardwareItems.id, row.hardware_item_id)).get(),
    approvers: approverDtos(db, id),
    attachments: db.select().from(s.attachments).where(eq(s.attachments.ticket_id, id)).all().map(a => ({
      ...a, type: a.type as AttachmentType, file_size: a.file_size ?? undefined, mime_type: a.mime_type ?? undefined, uploaded_at: a.uploaded_at.toISOString(),
    })),
    resolution_attempts: db.select().from(s.resolutionAttempts).where(eq(s.resolutionAttempts.ticket_id, id)).all().map(a => ({
      ...a, notes: a.notes ?? undefined, reopen_reason: a.reopen_reason ?? undefined, handled_by_id: a.handled_by_id ?? undefined,
      created_at: a.created_at.toISOString(), resolved_at: a.resolved_at?.toISOString(), reopened_at: a.reopened_at?.toISOString(), handled_by: loadUser(db, a.handled_by_id),
    })),
    audit_logs: db.select().from(s.auditLogs).where(eq(s.auditLogs.ticket_id, id)).orderBy(desc(sqliteDateMillis(s.auditLogs.created_at)), desc(s.auditLogs.id)).all().map(a => redactCommentAudit(a, isStaff(auth))).map(a => ({
      ...a, ticket_id: a.ticket_id ?? undefined, performed_by_id: a.performed_by_id ?? undefined,
      old_value: a.old_value ?? undefined, new_value: a.new_value ?? undefined, notes: a.notes ?? undefined,
      created_at: a.created_at.toISOString(), performed_by: loadUser(db, a.performed_by_id),
    })),
    comments: db.select().from(s.ticketComments).where(and(eq(s.ticketComments.ticket_id, id), isStaff(auth) ? undefined : eq(s.ticketComments.is_internal, false)))
      .orderBy(asc(sqliteDateMillis(s.ticketComments.created_at)), asc(s.ticketComments.id)).all().map(a => ({
        ...a, content: sanitizeRichText(a.content), created_at: a.created_at.toISOString(), updated_at: a.updated_at.toISOString(),
        user: db.select({ id: s.users.id, first_name: s.users.first_name, last_name: s.users.last_name, username: s.users.username })
          .from(s.users).where(eq(s.users.id, a.user_id)).get(),
      })),
    csat: customerSurvey ? {
      ...customerSurvey, rating_speed: customerSurvey.rating_speed ?? undefined, rating_attitude: customerSurvey.rating_attitude ?? undefined,
      rating_impact: customerSurvey.rating_impact ?? undefined, comment: customerSurvey.comment ?? undefined,
      resolution_time_ms: customerSurvey.resolution_time_ms ?? undefined, agent_id: customerSurvey.agent_id ?? undefined, submitted_at: customerSurvey.submitted_at.toISOString(),
    } : undefined,
  };
}

export function listPendingApprovals(db: Db, auth: AuthContext) {
  return db.select().from(s.ticketApprovers).where(and(eq(s.ticketApprovers.approver_id, auth.user), eq(s.ticketApprovers.status, 'pending')))
    .orderBy(desc(sqliteDateMillis(s.ticketApprovers.created_at)), desc(s.ticketApprovers.id)).all().map(row => ({
      ...row, status: row.status as ApprovalStatus, remarks: row.remarks ?? undefined, created_at: row.created_at.toISOString(), decided_at: row.decided_at?.toISOString(),
      ticket: ticketDto(db, db.select().from(s.tickets).where(eq(s.tickets.id, row.ticket_id)).get()!),
    }));
}
