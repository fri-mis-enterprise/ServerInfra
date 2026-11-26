import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import type { getDb } from './db';
import { migrateDatabase } from './db/migrate';
import * as s from './db/schema';
import * as writes from './ticket-writes';
import { createTicketSchema, decisionSchema, ticketChangesSchema } from '../validation/ticket-writes';
import { readTicket } from './ticket-reads';
import { subscribeEvents } from './realtime';
import { readTicketAuditTrail } from './audit-reads';

let sqlite: Database, db: ReturnType<typeof getDb>;
const owner = { user: 1, roles: ['user'] }, other = { user: 2, roles: ['user'] }, mis = { user: 3, roles: ['mis'] }, approver = { user: 4, roles: ['approver'] }, admin = { user: 5, roles: ['admin'] };
const body = { title: 'Example ticket', description: 'A detailed description of an issue' };
const row = (id: number) => db.select().from(s.tickets).where(eq(s.tickets.id, id)).get()!;
function status(run: () => unknown, code: number) {
  try { run(); throw new Error('Expected an HTTP error'); } catch (failure) { expect(failure).toMatchObject({ status: code }); }
}
function create(input: Parameters<typeof writes.createTicket>[2] = body) { return writes.createTicket(db, owner, input).value.id; }
beforeEach(() => {
  sqlite = new Database(':memory:'); migrateDatabase(sqlite); db = drizzle(sqlite);
  db.insert(s.departments).values({ id: 1, name: 'MIS' }).run();
  db.insert(s.requestTypes).values([{ id: 1, name: 'Others', department_id: 1 }, { id: 2, name: 'Approval', department_id: 1, requires_approval_by_default: true }]).run();
  db.insert(s.affectedSystems).values({ id: 1, name: 'Others', department_id: 1 }).run();
  for (const person of [owner, other, mis, approver, admin]) {
    db.insert(s.users).values({ id: person.user, first_name: `User${person.user}`, last_name: 'Test', username: `user${person.user}`, email: `${person.user}@example.com`, password: 'secret', department_id: person.user === 2 ? 1 : null }).run();
    db.insert(s.userRoles).values({ user_id: person.user, role: person.roles[0] }).run();
  }
});
afterEach(() => sqlite.close());

test('creation preserves fallback references, SLA, approval defaults, audit and queued notifications', () => {
  const before = Date.now();
  const created = writes.createTicket(db, owner, { ...body, priority: 'critical' });
  const ticket = row(created.value.id);
  expect(ticket).toMatchObject({ status: 'open', priority: 'critical', request_type_id: 1, affected_system_id: 1, department_id: 1 });
  expect(ticket.due_date!.getTime()).toBeGreaterThanOrEqual(before + 4 * 3_600_000);
  expect(created.notifications.map(notification => notification.user_id)).toEqual([mis.user]);
  const approval = create({ ...body, request_type_id: 2, requires_approval: false });
  expect(row(approval).status).toBe('pending_approval');
  expect(db.select().from(s.ticketApprovers).where(eq(s.ticketApprovers.ticket_id, approval)).get()?.approver_id).toBe(approver.user);
  expect(db.select().from(s.auditLogs).all()).toHaveLength(2);
});

test('ticket lifecycle resolves with attempt history and reopening resets CSAT and assignment atomically', () => {
  const id = create();
  writes.updateTicket(db, mis, id, { assignee_id: mis.user, status: 'in_progress' });
  const resolved = writes.updateTicket(db, mis, id, { status: 'resolved', resolution_notes: 'Fixed' });
  expect(resolved.value).toMatchObject({ status: 'resolved', assignee_id: mis.user });
  expect(db.select().from(s.resolutionAttempts).get()).toMatchObject({ attempt_number: 1, notes: 'Fixed', handled_by_id: mis.user });
  db.insert(s.csat).values({ ticket_id: id, agent_id: mis.user, rating: 5 }).run();
  const reopened = writes.updateTicket(db, owner, id, { status: 'open', reopen_reason: 'Still broken' });
  expect(reopened.value).toMatchObject({ status: 'open', reopen_count: 1 });
  expect(row(id)).toMatchObject({ assignee_id: null, started_at: null, completed_at: null });
  expect(db.select().from(s.csat).all()).toEqual([]);
  expect(db.select().from(s.resolutionAttempts).get()?.reopen_reason).toBe('Still broken');
  expect(reopened.notifications[0].type).toBe('ticket_reopened');
});

test('requesters cannot assign, change SLA or advance privileged status; department claim works', () => {
  const id = create();
  status(() => writes.updateTicket(db, owner, id, { assignee_id: mis.user }), 403);
  status(() => writes.updateTicket(db, owner, id, { due_date: null }), 403);
  status(() => writes.updateTicket(db, owner, id, { status: 'rejected' }), 403);
  status(() => writes.updateTicket(db, approver, id, { title: 'Unauthorized title' }), 403);
  writes.updateTicket(db, other, id, { assignee_id: other.user });
  writes.updateTicket(db, other, id, { status: 'in_progress' });
  expect(row(id)).toMatchObject({ assignee_id: other.user, status: 'in_progress' });
  status(() => writes.updateTicket(db, owner, id, { title: 'After work starts' }), 403);
  writes.updateTicket(db, other, id, { status: 'resolved' });
  status(() => writes.updateTicket(db, mis, id, { status: 'closed' }), 403);
  writes.updateTicket(db, admin, id, { status: 'closed' });
  expect(row(id).status).toBe('closed');
});

test('failed compound changes roll back assignment, audit, messages, notifications and broadcasts', () => {
  const id = create();
  const before = { audit: db.select().from(s.auditLogs).all().length, notices: db.select().from(s.notifications).all().length };
  const received: unknown[] = [];
  const unsub = subscribeEvents({ db, user: admin.user, expiresAt: Date.now() + 60_000, tickets: new Set([id]), send: event => received.push(event), close: () => {} });
  try {
    status(() => writes.updateTicket(db, admin, id, { assignee_id: mis.user, status: 'closed' }), 400);
    expect(row(id)).toMatchObject({ status: 'open', assignee_id: null });
    expect(db.select().from(s.auditLogs).all()).toHaveLength(before.audit);
    expect(db.select().from(s.notifications).all()).toHaveLength(before.notices);
    expect(db.select().from(s.messages).all()).toEqual([]);
    expect(received).toEqual([]);
  } finally { unsub(); }
});

test('approval decisions enforce identity, pending state, valid decisions and all-approver completion', () => {
  const id = create({ ...body, request_type_id: 2 });
  db.insert(s.userRoles).values({ user_id: other.user, role: 'approver' }).run();
  writes.addTicketApprovers(db, mis, id, [other.user]);
  const approvals = db.select().from(s.ticketApprovers).where(eq(s.ticketApprovers.ticket_id, id)).all();
  const first = approvals.find(approval => approval.approver_id === approver.user)!;
  const second = approvals.find(approval => approval.approver_id === other.user)!;
  const secondApprover = { ...other, roles: ['approver'] };
  status(() => writes.decideApproval(db, other, { id: first.id, ticket_id: id, decision: 'approved' }), 403);
  const partial = writes.decideApproval(db, approver, { id: first.id, ticket_id: id, decision: 'approved' });
  expect(partial.value).toMatchObject({ ticket_status: 'pending_approval', pending_approvers: 1 });
  status(() => writes.decideApproval(db, approver, { id: first.id, ticket_id: id, decision: 'approved' }), 403);
  status(() => writes.decideApproval(db, other, { id: second.id, ticket_id: id, decision: 'approved' }), 403);
  const complete = writes.decideApproval(db, secondApprover, { id: second.id, ticket_id: id, decision: 'approved' });
  expect(complete.value.ticket_status).toBe('open');
  status(() => writes.decideApproval(db, secondApprover, { id: second.id, ticket_id: id, decision: 'rejected' }), 409);
  expect(decisionSchema.safeParse({ id: first.id, ticket_id: id, decision: 'anything' }).success).toBe(false);
});

test('closing follows the lifecycle and is restricted to administrators', () => {
  const id = create();
  status(() => writes.updateTicket(db, admin, id, { status: 'closed' }), 400);
  writes.updateTicket(db, mis, id, { assignee_id: mis.user, status: 'in_progress' });
  writes.updateTicket(db, mis, id, { status: 'resolved' });
  status(() => writes.updateTicket(db, mis, id, { status: 'closed' }), 403);
  status(() => writes.updateTicket(db, owner, id, { status: 'closed' }), 403);
  expect(row(id).status).toBe('resolved');
  writes.updateTicket(db, admin, id, { status: 'closed' });
  expect(row(id).status).toBe('closed');
});

test('approval escalation, pending removal and rejection preserve ticket states', () => {
  const id = create();
  const added = writes.toggleTicketApprover(db, mis, id, approver.user);
  expect(added.value).toMatchObject({ action: 'added', escalated: true });
  expect(row(id)).toMatchObject({ status: 'pending_approval', escalated_to_approval: true });
  const removed = writes.toggleTicketApprover(db, mis, id, approver.user);
  expect(removed.value).toMatchObject({ action: 'removed', status: 'open' });
  expect(row(id).escalated_to_approval).toBe(false);
  writes.escalateTicket(db, admin, id);
  const record = db.select().from(s.ticketApprovers).where(eq(s.ticketApprovers.ticket_id, id)).get()!;
  writes.decideApproval(db, approver, { id: record.id, ticket_id: id, decision: 'rejected', remarks: 'Cannot proceed' });
  expect(row(id).status).toBe('rejected');
  status(() => writes.toggleTicketApprover(db, mis, id, approver.user), 400);
});

test('comments enforce membership, author ownership and internal privacy including audit history', () => {
  const id = create();
  status(() => writes.createComment(db, other, { ticket_id: id, content: 'No access' }), 403);
  status(() => writes.createComment(db, owner, { ticket_id: id, content: 'Secret', is_internal: true }), 403);
  const publicComment = writes.createComment(db, owner, { ticket_id: id, content: 'Public reply' }).value;
  status(() => writes.updateComment(db, mis, publicComment.id, { content: 'Not my comment' }), 403);
  status(() => writes.updateComment(db, owner, publicComment.id, { is_internal: true }), 403);
  const privateComment = writes.createComment(db, mis, { ticket_id: id, content: 'Secret internal text', is_internal: true }).value;
  expect(writes.createComment(db, mis, { ticket_id: id, content: 'Another internal secret', is_internal: true }).notifications).toEqual([]);
  const view = readTicket(db, owner, id);
  expect(view.comments?.map(comment => comment.id)).toEqual([publicComment.id]);
  expect(JSON.stringify(view.audit_logs)).not.toContain('Secret internal text');
  status(() => writes.deleteComment(db, other, publicComment.id), 403);
  writes.updateComment(db, mis, privateComment.id, { content: 'Changed internal secret' });
  writes.deleteComment(db, mis, privateComment.id);
  expect(JSON.stringify(readTicket(db, owner, id))).not.toContain('internal secret');
  writes.deleteComment(db, owner, publicComment.id);
  expect(db.select().from(s.ticketComments).all()).toEqual([expect.objectContaining({ content: 'Another internal secret' })]);
});

test('write schemas reject invalid enums, references, dates and privilege injection', () => {
  expect(createTicketSchema.safeParse({ ...body, requester_id: 99 }).success).toBe(false);
  expect(createTicketSchema.safeParse({ ...body, priority: 'urgent' }).success).toBe(false);
  expect(ticketChangesSchema.safeParse({ due_date: 'tomorrow' }).success).toBe(false);
  expect(ticketChangesSchema.safeParse({ assignee_id: -1 }).success).toBe(false);
  status(() => create({ ...body, request_type_id: 999 }), 400);
  expect(db.select().from(s.tickets).all()).toEqual([]);
});

test('historic audit comments cannot expose internal note text to requesters', () => {
  const id = create();
  db.insert(s.auditLogs).values([
    { ticket_id: id, action: 'comment_added', old_value: 'internal', new_value: 'Historic internal secret' },
    { ticket_id: id, action: 'comment_added', old_value: 'public', new_value: 'Public comment history' },
    { ticket_id: id, action: 'comment_deleted', old_value: 'Deleted internal secret' },
    { ticket_id: id, action: 'description_changed', old_value: 'Previous description', new_value: 'New description' },
  ]).run();
  for (const history of [readTicket(db, owner, id).audit_logs, readTicketAuditTrail(db, owner, id)]) {
    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain('Historic internal secret');
    expect(serialized).not.toContain('Deleted internal secret');
    expect(serialized).toContain('Public comment history');
    expect(serialized).toContain('Previous description');
  }
  expect(JSON.stringify(readTicketAuditTrail(db, mis, id))).toContain('Historic internal secret');
  expect(JSON.stringify(readTicket(db, approver, id).audit_logs)).toContain('Deleted internal secret');
});

test('staff changing comment audience emits only a refresh event and no private comment payload', () => {
  const id = create();
  const comment = writes.createComment(db, mis, { ticket_id: id, content: 'Initially public' }).value;
  const received: { type: string; payload: unknown }[] = [];
  const unsub = subscribeEvents({ db, user: owner.user, expiresAt: Date.now() + 60_000, tickets: new Set([id]), send: event => received.push(event), close: () => {} });
  try {
    writes.updateComment(db, mis, comment.id, { content: 'Changed private secret', is_internal: true });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'ticket_updated', payload: { field: 'comments, updated' } });
    expect(JSON.stringify(received)).not.toContain('Changed private secret');
    expect(readTicket(db, owner, id).comments).toEqual([]);
  } finally { unsub(); }
});

test('reopening a rejected approval resets decisions and requires fresh approval before work begins', () => {
  const id = create({ ...body, request_type_id: 2 });
  const approval = db.select().from(s.ticketApprovers).where(eq(s.ticketApprovers.ticket_id, id)).get()!;
  writes.decideApproval(db, approver, { id: approval.id, ticket_id: id, decision: 'rejected', remarks: 'Original rejection' });
  const reopened = writes.updateTicket(db, owner, id, { status: 'open', reopen_reason: 'Additional information supplied' });
  expect(reopened.value).toMatchObject({ status: 'pending_approval', reopen_count: 1 });
  expect(db.select().from(s.ticketApprovers).where(eq(s.ticketApprovers.id, approval.id)).get()).toMatchObject({ status: 'pending', remarks: null, decided_at: null });
  expect(reopened.notifications.some(notification => notification.user_id === approver.user && notification.type === 'approval_requested')).toBe(true);
  status(() => writes.updateTicket(db, mis, id, { assignee_id: mis.user, status: 'in_progress' }), 400);
  expect(row(id).assignee_id).toBeNull();
  writes.decideApproval(db, approver, { id: approval.id, ticket_id: id, decision: 'approved' });
  expect(row(id).status).toBe('open');
  writes.updateTicket(db, mis, id, { assignee_id: mis.user, status: 'in_progress' });
  expect(row(id).status).toBe('in_progress');
});

test('writes and historic ticket/comment reads sanitize HTML before it reaches the browser', () => {
  const id = create({ ...body, description: '<p>Valid description text</p><script>createAttack()</script>' });
  expect(row(id).description).toBe('<p>Valid description text</p>');
  writes.updateTicket(db, owner, id, { description: '<p onclick="evil()">Updated description</p>' });
  expect(row(id).description).toBe('<p>Updated description</p>');
  const comment = writes.createComment(db, owner, { ticket_id: id, content: '<p onmouseover="evil()">Safe comment</p>' }).value;
  expect(comment.content).toBe('<p>Safe comment</p>');
  writes.updateComment(db, owner, comment.id, { content: '<p>Edited comment</p><img src=x onerror=evil()>' });
  expect(db.select().from(s.ticketComments).where(eq(s.ticketComments.id, comment.id)).get()!.content).toBe('<p>Edited comment</p>');
  db.update(s.tickets).set({ description: '<p>Legacy description</p><iframe src="https://evil.example"></iframe>' }).where(eq(s.tickets.id, id)).run();
  db.update(s.ticketComments).set({ content: '<p onclick="evil()">Legacy comment</p>' }).where(eq(s.ticketComments.id, comment.id)).run();
  const historic = readTicket(db, owner, id);
  expect(historic.description).toBe('<p>Legacy description</p>');
  expect(historic.comments![0].content).toBe('<p>Legacy comment</p>');
  status(() => writes.createComment(db, owner, { ticket_id: id, content: '<script>onlyAttack()</script>' }), 400);
});
