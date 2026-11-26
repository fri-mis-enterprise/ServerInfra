import { error } from '@sveltejs/kit';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthContext } from './auth';
import type { getDb } from './db';
import * as s from './db/schema';
import { sqliteDateMillis } from './db/date';
import { queueNotification } from './notifications';
import { broadcaster } from './realtime';
import { readTicket } from './ticket-reads';
import { sanitizeRichText } from './rich-text';
import type { createTicketSchema, ticketChangesSchema, decisionSchema, createCommentSchema, commentChangesSchema } from '../validation/ticket-writes';

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Queries = Pick<Db, 'select' | 'selectDistinct' | 'insert' | 'update' | 'delete'>;
type TicketRow = typeof s.tickets.$inferSelect;
type Notice = ReturnType<typeof queueNotification>;
type Context = { db: Tx; notices: Notice[]; events: (() => void)[] };
const staff = (auth: AuthContext) => auth.roles.some(role => role === 'admin' || role === 'mis');
const internalStaff = (auth: AuthContext) => staff(auth) || auth.roles.includes('approver');
const terminal = ['resolved', 'closed', 'rejected'];
const transitions: Record<string, string[]> = {
  open: ['in_progress', 'pending_approval', 'rejected'],
  in_progress: ['pending_approval', 'pending_hard_copy', 'resolved', 'open'],
  pending_approval: ['in_progress', 'rejected'], pending_hard_copy: ['resolved', 'in_progress'],
  resolved: ['closed', 'open'], closed: ['open'], rejected: ['open'],
};

function mutate<T>(db: Db, run: (context: Context) => T) {
  const notices: Notice[] = [], events: (() => void)[] = [];
  const value = db.transaction(tx => run({ db: tx, notices, events }), { behavior: 'immediate' });
  for (const publish of events) publish();
  return { value, notifications: notices };
}
function notify(context: Context, userId: number, ticketId: number, type: string, message: string) {
  context.notices.push(queueNotification(context.db, userId, ticketId, type, message));
}
function ticket(db: Queries, id: number) {
  const row = db.select().from(s.tickets).where(eq(s.tickets.id, id)).get();
  if (!row) error(404, 'Ticket not found');
  return row;
}
function audit(db: Queries, auth: AuthContext, ticketId: number, action: string, oldValue: string | null = null, newValue: string | null = null, notes?: string) {
  db.insert(s.auditLogs).values({ ticket_id: ticketId, performed_by_id: auth.user, action, old_value: oldValue, new_value: newValue, notes }).run();
}
function activeRoleUsers(db: Queries, roles: string[]) {
  return db.selectDistinct({ id: s.users.id }).from(s.users).innerJoin(s.userRoles, eq(s.userRoles.user_id, s.users.id))
    .where(and(eq(s.users.is_active, true), inArray(s.userRoles.role, roles))).orderBy(asc(s.users.id)).all();
}
function approvers(db: Queries, ticketId: number) {
  return db.select().from(s.ticketApprovers).where(eq(s.ticketApprovers.ticket_id, ticketId)).all();
}
function checkStaff(auth: AuthContext) { if (!staff(auth)) error(403, 'Only admin/MIS can manage this ticket'); }
function checkAccess(db: Queries, auth: AuthContext, row: TicketRow) {
  if (!internalStaff(auth) && row.requester_id !== auth.user && row.assignee_id !== auth.user && !approvers(db, row.id).some(a => a.approver_id === auth.user)) error(403, 'Access denied');
}
function checkReferences(db: Queries, values: z.infer<typeof ticketChangesSchema>) {
  const tables = { department_id: s.departments, request_type_id: s.requestTypes, affected_system_id: s.affectedSystems, hardware_item_id: s.hardwareItems };
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    if (values[key] == null) continue;
    const table = tables[key];
    const row = db.select({ id: table.id, is_active: table.is_active }).from(table).where(eq(table.id, values[key]!)).get();
    if (!row?.is_active) error(400, `Invalid ${key}`);
  }
}
function personName(db: Queries, id: number | null) {
  if (id === null) return 'unassigned';
  const row = db.select().from(s.users).where(eq(s.users.id, id)).get();
  return row ? `${row.first_name} ${row.last_name} (${row.username})` : String(id);
}
function ticketEvent(context: Context, auth: AuthContext, id: number, oldStatus: string, status: string, field = 'status') {
  context.events.push(() => broadcaster.ticketUpdated(id, { field, old_value: oldStatus, new_value: status, status, updated_by: `User #${auth.user}` }));
}

export function createTicket(db: Db, auth: AuthContext, input: z.infer<typeof createTicketSchema>) {
  input = { ...input, description: sanitizeRichText(input.description) };
  if (!input.description.trim()) error(400, 'Description is required');
  return mutate(db, context => {
    const tx = context.db;
    checkReferences(tx, input);
    const requestType = input.request_type_id
      ? tx.select().from(s.requestTypes).where(eq(s.requestTypes.id, input.request_type_id)).get()
      : tx.select().from(s.requestTypes).where(and(eq(s.requestTypes.name, 'Others'), eq(s.requestTypes.is_active, true))).get();
    const affectedSystem = input.affected_system_id
      ? tx.select().from(s.affectedSystems).where(eq(s.affectedSystems.id, input.affected_system_id)).get()
      : tx.select().from(s.affectedSystems).where(and(eq(s.affectedSystems.name, 'Others'), eq(s.affectedSystems.is_active, true))).get();
    const departmentId = input.department_id ?? affectedSystem?.department_id ?? requestType?.department_id ?? tx.select().from(s.departments).where(and(eq(s.departments.name, 'MIS'), eq(s.departments.is_active, true))).get()?.id;
    const requiresApproval = staff(auth) ? input.requires_approval ?? requestType?.requires_approval_by_default ?? false
      : Boolean(input.requires_approval || requestType?.requires_approval_by_default);
    const priority = input.priority ?? 'medium';
    const dueDate = input.due_date ? new Date(input.due_date) : new Date(Date.now() + ({ critical: 4, high: 24, medium: 72, low: 120 }[priority]) * 3_600_000);
    const defaultApprover = requiresApproval ? activeRoleUsers(tx, ['approver'])[0] ?? activeRoleUsers(tx, ['admin', 'mis'])[0] : undefined;
    if (requiresApproval && !defaultApprover) error(400, 'No active approver is available');
    const row = tx.insert(s.tickets).values({
      ...input, requester_id: auth.user, request_type_id: requestType?.id, affected_system_id: affectedSystem?.id,
      department_id: departmentId, priority, requires_approval: requiresApproval,
      status: requiresApproval ? 'pending_approval' : 'open', due_date: dueDate,
    }).returning().get()!;
    const department = departmentId == null ? undefined : tx.select().from(s.departments).where(eq(s.departments.id, departmentId)).get();
    audit(tx, auth, row.id, 'ticket_created', null, row.status, `Ticket created for ${department?.name ?? 'Unknown'} department with priority ${priority}. SLA set to ${dueDate.toISOString()}.`);
    if (defaultApprover) {
      tx.insert(s.ticketApprovers).values({ ticket_id: row.id, approver_id: defaultApprover.id }).run();
      notify(context, defaultApprover.id, row.id, 'approval_requested', `New approval request for ticket #${row.id}: ${row.title}`);
    } else {
      for (const mis of activeRoleUsers(tx, ['mis'])) notify(context, mis.id, row.id, 'ticket_created', `New ticket created: ${row.title}`);
    }
    return { id: row.id };
  });
}

export function updateTicket(db: Db, auth: AuthContext, id: number, input: z.infer<typeof ticketChangesSchema>) {
  if (input.description !== undefined) {
    input = { ...input, description: sanitizeRichText(input.description) };
    if (!input.description!.trim()) error(400, 'Description is required');
  }
  const result = mutate(db, context => {
    const tx = context.db, row = ticket(tx, id);
    const actor = tx.select().from(s.users).where(eq(s.users.id, auth.user)).get();
    const departmentClaim = !row.assignee_id && input.assignee_id === auth.user && actor?.department_id != null && actor.department_id === row.department_id;
    const assigned = row.assignee_id === auth.user;
    const owner = row.requester_id === auth.user;
    if (!staff(auth) && !owner && !assigned && !departmentClaim) error(403, 'Access denied');
    checkReferences(tx, input);
    const data: Partial<typeof s.tickets.$inferInsert> = {};
    const statusChanged = input.status !== undefined && input.status !== row.status;
    const reopening = statusChanged && input.status === 'open' && terminal.includes(row.status);
    if (!staff(auth)) {
      if (input.priority !== undefined || input.due_date !== undefined || input.other_request_type !== undefined || input.other_affected_system !== undefined || input.other_department !== undefined) error(403, 'Only staff can change priority, SLA and other reference fields');
      if (input.assignee_id !== undefined && input.assignee_id !== row.assignee_id && !departmentClaim) error(403, 'Only staff can reassign tickets');
      if (statusChanged && !reopening && !assigned) error(403, 'Only staff or the assignee can change ticket status');
      if (reopening && !owner) error(403, 'Only the requester or staff can reopen this ticket');
      if (['title', 'description', 'department_id', 'request_type_id', 'affected_system_id', 'hardware_item_id'].some(key => key in input) && (!owner || !['open', 'rejected', 'pending_approval'].includes(row.status))) error(403, 'Ticket content can no longer be edited');
    }
    if (input.assignee_id !== undefined && input.assignee_id !== row.assignee_id) {
      if (terminal.includes(row.status) && !reopening) error(400, 'Cannot reassign a completed ticket');
      const target = input.assignee_id === null ? null : tx.select().from(s.users).where(eq(s.users.id, input.assignee_id)).get();
      if (input.assignee_id !== null && !target?.is_active) error(400, 'Invalid assignee');
      data.assignee_id = input.assignee_id;
      audit(tx, auth, id, 'assignment', personName(tx, row.assignee_id), personName(tx, input.assignee_id));
      tx.update(s.csat).set({ agent_id: input.assignee_id }).where(eq(s.csat.ticket_id, id)).run();
      if (input.assignee_id !== null) {
        if (input.assignee_id !== auth.user) {
          const message = tx.insert(s.messages).values({ sender_id: auth.user, receiver_id: input.assignee_id, ticket_id: id, content: `You have been assigned to ticket #${id}: ${row.title}` }).returning().get()!;
          context.events.push(() => broadcaster.messageSent(message.receiver_id, { ...message, created_at: message.created_at.toISOString() }));
        }
        notify(context, input.assignee_id, id, 'ticket_assigned', `You have been assigned to ticket: ${row.title}`);
      }
    }
    if (statusChanged) {
      const next = input.status!;
      if (!transitions[row.status]?.includes(next)) error(400, `Cannot transition from ${row.status} to ${next}`);
      if (next === 'closed' && !auth.roles.includes('admin')) error(403, 'Only an administrator can close this ticket');
      if (row.status === 'pending_approval' && next === 'in_progress' && approvers(tx, id).some(a => a.status !== 'approved')) error(400, 'All approvers must approve before work can begin');
      if (next === 'in_progress' && !(data.assignee_id === undefined ? row.assignee_id : data.assignee_id)) error(400, 'An assignee is required to start progress on this ticket');
      data.status = next;
      if (next === 'in_progress') data.started_at = new Date();
      if (next === 'resolved' || next === 'closed') data.completed_at = new Date();
      if (next === 'resolved') {
        const assigneeId = data.assignee_id === undefined ? row.assignee_id : data.assignee_id;
        if (!assigneeId) error(400, 'An assignee is required to resolve this ticket');
        const number = tx.select({ total: count() }).from(s.resolutionAttempts).where(eq(s.resolutionAttempts.ticket_id, id)).get()!.total + 1;
        tx.insert(s.resolutionAttempts).values({ ticket_id: id, attempt_number: number, handled_by_id: assigneeId, resolved_at: new Date(), notes: input.resolution_notes ?? null }).run();
        notify(context, row.requester_id, id, 'ticket_resolved', `Your ticket "${row.title}" has been resolved.`);
      }
      if (reopening) {
        data.completed_at = null; data.started_at = null; data.reopen_count = row.reopen_count + 1; data.assignee_id = null;
        const previousApprovers = row.status === 'rejected' ? approvers(tx, id) : [];
        if (previousApprovers.length) {
          tx.update(s.ticketApprovers).set({ status: 'pending', remarks: null, decided_at: null }).where(eq(s.ticketApprovers.ticket_id, id)).run();
          data.status = 'pending_approval';
          for (const approver of previousApprovers) notify(context, approver.approver_id, id, 'approval_requested', `Reopened ticket #${id} requires approval: ${row.title}`);
        }
        const attempt = tx.select().from(s.resolutionAttempts).where(eq(s.resolutionAttempts.ticket_id, id)).orderBy(desc(sqliteDateMillis(s.resolutionAttempts.created_at)), desc(s.resolutionAttempts.id)).get();
        if (attempt) tx.update(s.resolutionAttempts).set({ reopened_at: new Date(), reopen_reason: input.reopen_reason || 'Ticket reopened' }).where(eq(s.resolutionAttempts.id, attempt.id)).run();
        tx.delete(s.csat).where(eq(s.csat.ticket_id, id)).run();
        notify(context, row.requester_id, id, 'ticket_reopened', `Your ticket "${row.title}" has been reopened.`);
      }
      audit(tx, auth, id, 'status_change', row.status, data.status ?? next);
    }
    const fields = ['title', 'description', 'priority', 'department_id', 'request_type_id', 'affected_system_id', 'hardware_item_id', 'other_request_type', 'other_affected_system', 'other_department'] as const;
    for (const key of fields) {
      if (input[key] === undefined || input[key] === row[key]) continue;
      Object.assign(data, { [key]: input[key] });
      audit(tx, auth, id, `${key.replace(/_id$/, '')}_changed`, row[key] == null ? 'none' : String(row[key]).slice(0, key === 'description' ? 100 : undefined), input[key] == null ? 'none' : String(input[key]).slice(0, key === 'description' ? 100 : undefined));
    }
    if (input.due_date !== undefined) {
      data.due_date = input.due_date === null ? null : new Date(input.due_date);
      if (input.due_date === null) { data.sla_breached = false; data.breached_at = null; }
    }
    if (Object.keys(data).length) {
      tx.update(s.tickets).set(data).where(eq(s.tickets.id, id)).run();
      ticketEvent(context, auth, id, row.status, data.status ?? row.status, Object.keys(data).join(', '));
    }
    return id;
  });
  return { ...result, value: readTicket(db, auth, result.value) };
}

function checkManageApprovers(auth: AuthContext, row: TicketRow) {
  checkStaff(auth);
  if (terminal.includes(row.status)) error(400, 'Cannot manage approvers on a completed or rejected ticket');
}
function addApprovers(context: Context, auth: AuthContext, row: TicketRow, ids: number[]) {
  const tx = context.db;
  checkManageApprovers(auth, row);
  const valid = new Set(activeRoleUsers(tx, ['approver']).map(user => user.id));
  if (ids.some(id => !valid.has(id))) error(400, 'One or more users are not valid approvers');
  const existing = new Set(approvers(tx, row.id).map(a => a.approver_id));
  const created = [...new Set(ids)].filter(id => !existing.has(id)).map(approverId => {
    const result = tx.insert(s.ticketApprovers).values({ ticket_id: row.id, approver_id: approverId }).returning().get()!;
    notify(context, approverId, row.id, 'approval_requested', `You have been requested to approve ticket #${row.id}: ${row.title}`);
    return result;
  });
  if (created.length) {
    const escalated = !row.requires_approval && !row.escalated_to_approval;
    tx.update(s.tickets).set({ status: 'pending_approval', ...(escalated ? { escalated_to_approval: true, escalated_at: new Date(), escalated_by_id: auth.user } : {}) }).where(eq(s.tickets.id, row.id)).run();
    audit(tx, auth, row.id, 'approvers_added', null, created.map(a => personName(tx, a.approver_id)).join(', '));
    audit(tx, auth, row.id, escalated ? 'escalated' : 'status_change', row.status, 'pending_approval', 'Ticket returned to pending approval due to new approver assignment.');
    notify(context, row.requester_id, row.id, 'approval_requested', `Your ticket "${row.title}" is pending approval.`);
    ticketEvent(context, auth, row.id, row.status, 'pending_approval', 'status, escalated');
  }
  return created.map(a => ({ ...a, created_at: a.created_at.toISOString(), decided_at: a.decided_at?.toISOString() }));
}
function removeApprover(context: Context, auth: AuthContext, row: TicketRow, id: number) {
  const tx = context.db;
  checkManageApprovers(auth, row);
  const deleted = tx.delete(s.ticketApprovers).where(and(eq(s.ticketApprovers.ticket_id, row.id), eq(s.ticketApprovers.id, id), eq(s.ticketApprovers.status, 'pending'))).returning().get();
  if (!deleted) error(404, 'Pending approver not found for this ticket');
  const remaining = approvers(tx, row.id);
  let next = row.status;
  if (!remaining.some(a => a.status === 'pending') && row.status === 'pending_approval') {
    next = remaining.some(a => a.status === 'rejected') ? 'rejected' : row.assignee_id ? 'in_progress' : 'open';
    tx.update(s.tickets).set({ status: next, ...(remaining.length === 0 ? { escalated_to_approval: false } : {}) }).where(eq(s.tickets.id, row.id)).run();
    audit(tx, auth, row.id, 'status_change', row.status, next, `Ticket returned to ${next} because no pending approvers remain.`);
    ticketEvent(context, auth, row.id, row.status, next);
  }
  audit(tx, auth, row.id, 'approver_removed', null, String(deleted.approver_id));
  return { action: 'removed', status: next };
}
export function addTicketApprovers(db: Db, auth: AuthContext, ticketId: number, ids: number[]) {
  return mutate(db, context => addApprovers(context, auth, ticket(context.db, ticketId), ids));
}
export function removeTicketApprover(db: Db, auth: AuthContext, ticketId: number, id: number) {
  return mutate(db, context => removeApprover(context, auth, ticket(context.db, ticketId), id));
}
export function toggleTicketApprover(db: Db, auth: AuthContext, ticketId: number, approverId: number) {
  return mutate(db, context => {
    const row = ticket(context.db, ticketId);
    const existing = approvers(context.db, ticketId).find(a => a.approver_id === approverId);
    if (existing) return removeApprover(context, auth, row, existing.id);
    const escalated = !row.requires_approval && !row.escalated_to_approval;
    addApprovers(context, auth, row, [approverId]);
    return { action: 'added', escalated };
  });
}
export function escalateTicket(db: Db, auth: AuthContext, id: number) {
  return mutate(db, context => {
    const tx = context.db, row = ticket(tx, id);
    checkManageApprovers(auth, row);
    if (row.escalated_to_approval) error(400, 'Ticket is already escalated');
    const existing = approvers(tx, id);
    if (!existing.some(a => a.status === 'pending')) {
      const candidate = [...activeRoleUsers(tx, ['approver']), ...activeRoleUsers(tx, ['admin'])].find(user => !existing.some(a => a.approver_id === user.id));
      if (!candidate) error(400, 'No active approver is available');
      tx.insert(s.ticketApprovers).values({ ticket_id: id, approver_id: candidate.id }).run();
      notify(context, candidate.id, id, 'approval_requested', `ESCALATED: Ticket #${id} requires urgent approval.`);
    }
    tx.update(s.tickets).set({ status: 'pending_approval', escalated_to_approval: true, escalated_at: new Date(), escalated_by_id: auth.user }).where(eq(s.tickets.id, id)).run();
    audit(tx, auth, id, 'escalated', row.status, 'pending_approval', 'Ticket escalated to approval by MIS staff.');
    notify(context, row.requester_id, id, 'escalated', `Your ticket "${row.title}" has been escalated for approval.`);
    ticketEvent(context, auth, id, row.status, 'pending_approval', 'status, escalated');
    return { id, status: 'pending_approval' };
  });
}
export function decideApproval(db: Db, auth: AuthContext, input: z.infer<typeof decisionSchema>) {
  return mutate(db, context => {
    if (!internalStaff(auth)) error(403, 'An active approver role is required');
    const tx = context.db, row = ticket(tx, input.ticket_id);
    if (row.status !== 'pending_approval') error(409, 'Ticket is no longer pending approval');
    const approval = approvers(tx, row.id).find(a => a.id === input.id && a.approver_id === auth.user && a.status === 'pending');
    if (!approval) error(403, 'You are not a pending approver for this ticket');
    const changed = tx.update(s.ticketApprovers).set({ status: input.decision, remarks: input.remarks ?? null, decided_at: new Date() }).where(and(eq(s.ticketApprovers.id, approval.id), eq(s.ticketApprovers.status, 'pending'))).returning().get();
    if (!changed) error(409, 'Approval has already been decided');
    audit(tx, auth, row.id, 'approval_decision', null, input.decision, `${personName(tx, auth.user)}: ${input.remarks || '(no remarks)'}`);
    const all = approvers(tx, row.id), pending = all.filter(a => a.status === 'pending').length;
    const rejected = all.some(a => a.status === 'rejected');
    const next = rejected ? 'rejected' : pending === 0 ? row.assignee_id ? 'in_progress' : 'open' : 'pending_approval';
    if (next !== row.status) {
      tx.update(s.tickets).set({ status: next, ...(next === 'in_progress' ? { started_at: new Date() } : next === 'open' ? { started_at: null } : {}) }).where(eq(s.tickets.id, row.id)).run();
      audit(tx, auth, row.id, 'status_change', row.status, next);
      notify(context, row.requester_id, row.id, 'approval_decided', `Your ticket "${row.title}" has been ${rejected ? 'rejected' : 'approved'}.`);
      if (!rejected) for (const mis of activeRoleUsers(tx, ['mis'])) notify(context, mis.id, row.id, 'approval_decided', `Ticket "${row.title}" has been approved and needs assignment.`);
      ticketEvent(context, auth, row.id, row.status, next);
    }
    return { message: next === 'pending_approval' ? `Decision recorded as ${input.decision}` : `Ticket ${input.decision}`, ticket_status: next, pending_approvers: pending };
  });
}
function commentDto(db: Queries, row: typeof s.ticketComments.$inferSelect) {
  const user = db.select({ id: s.users.id, first_name: s.users.first_name, last_name: s.users.last_name, username: s.users.username }).from(s.users).where(eq(s.users.id, row.user_id)).get();
  return { ...row, content: sanitizeRichText(row.content), created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(), user };
}
export function createComment(db: Db, auth: AuthContext, input: z.infer<typeof createCommentSchema>) {
  input = { ...input, content: sanitizeRichText(input.content) };
  if (!input.content.trim()) error(400, 'Comment content is required');
  return mutate(db, context => {
    const tx = context.db, row = ticket(tx, input.ticket_id);
    checkAccess(tx, auth, row);
    if (input.is_internal && !internalStaff(auth)) error(403, 'Only staff can post internal notes');
    const comment = tx.insert(s.ticketComments).values({ ...input, user_id: auth.user }).returning().get()!;
    const recipients = new Set([row.requester_id, ...(row.assignee_id ? [row.assignee_id] : []), ...approvers(tx, row.id).map(a => a.approver_id)]);
    recipients.delete(auth.user);
    for (const recipient of recipients) {
      if (comment.is_internal && !activeRoleUsers(tx, ['admin', 'mis', 'approver']).some(person => person.id === recipient)) continue;
      notify(context, recipient, row.id, 'comment_added', `New ${comment.is_internal ? 'internal note' : 'comment'} on ticket: ${row.title}`);
    }
    // Public audit history must never contain the text of an internal note.
    audit(tx, auth, row.id, 'comment_added', comment.is_internal ? 'internal' : 'public', comment.is_internal ? null : comment.content.slice(0, 200));
    const dto = commentDto(tx, comment);
    context.events.push(() => broadcaster[comment.is_internal ? 'internalNoteAdded' : 'commentAdded'](row.id, dto));
    return dto;
  });
}
export function updateComment(db: Db, auth: AuthContext, id: number, input: z.infer<typeof commentChangesSchema>) {
  if (input.content !== undefined) {
    input = { ...input, content: sanitizeRichText(input.content) };
    if (!input.content!.trim()) error(400, 'Comment content is required');
  }
  return mutate(db, context => {
    const tx = context.db;
    const row = tx.select().from(s.ticketComments).where(eq(s.ticketComments.id, id)).get();
    if (!row) error(404, 'Comment not found');
    checkAccess(tx, auth, ticket(tx, row.ticket_id));
    if (row.user_id !== auth.user) error(403, 'You can only edit your own comments');
    if ((row.is_internal || input.is_internal) && !internalStaff(auth)) error(403, 'Only staff can manage internal notes');
    const updated = tx.update(s.ticketComments).set(input).where(eq(s.ticketComments.id, id)).returning().get()!;
    audit(tx, auth, row.ticket_id, 'comment_updated', updated.is_internal ? 'internal' : 'public', updated.is_internal ? null : updated.content.slice(0, 200));
    ticketEvent(context, auth, row.ticket_id, '', ticket(tx, row.ticket_id).status, 'comments, updated');
    return commentDto(tx, updated);
  });
}
export function deleteComment(db: Db, auth: AuthContext, id: number) {
  return mutate(db, context => {
    const tx = context.db;
    const row = tx.select().from(s.ticketComments).where(eq(s.ticketComments.id, id)).get();
    if (!row) error(404, 'Comment not found');
    checkAccess(tx, auth, ticket(tx, row.ticket_id));
    if (row.user_id !== auth.user && !staff(auth)) error(403, 'You can only delete your own comments');
    if (row.is_internal && !internalStaff(auth)) error(403, 'Access denied');
    audit(tx, auth, row.ticket_id, 'comment_deleted', row.is_internal ? null : row.content.slice(0, 200));
    tx.delete(s.ticketComments).where(eq(s.ticketComments.id, id)).run();
    ticketEvent(context, auth, row.ticket_id, '', ticket(tx, row.ticket_id).status, 'comments, deleted');
    return { message: 'Comment deleted' };
  });
}
