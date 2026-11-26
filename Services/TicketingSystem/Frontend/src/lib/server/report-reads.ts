import { error } from '@sveltejs/kit';
import { and, asc, count, desc, eq, getTableColumns, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import { alias, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { AuthContext } from './auth';
import type { getDb } from './db';
import { affectedSystems, csat, departments, requestTypes, ticketApprovers, tickets, users } from './db/schema';
import type { DashboardQuery, TicketReportQuery } from '../validation/reports';
import { ticketDto } from './ticket-reads';
import { sanitizeRichText } from './rich-text';
import { sqliteDateMillis as dateNumber } from './db/date';

type Db = ReturnType<typeof getDb>;
const terminal = ['resolved', 'closed'];
const personFields = <T extends Record<'id' | 'first_name' | 'last_name' | 'username', AnySQLiteColumn>>(table: T): Pick<T, 'id' | 'first_name' | 'last_name' | 'username'> => ({ id: table.id, first_name: table.first_name, last_name: table.last_name, username: table.username });

export function readDashboardSummary(db: Db, auth: AuthContext, input: DashboardQuery, now = new Date()) {
  const staff = auth.roles.some(role => ['admin', 'mis', 'approver'].includes(role));
  const conditions: SQL[] = [];
  if (input.department_id) conditions.push(eq(tickets.department_id, input.department_id));
  if (!staff) conditions.push(eq(tickets.requester_id, auth.user));
  const where = and(...conditions);
  const overdue = and(sql`${dateNumber(tickets.due_date)} <= ${now.getTime()}`, notInArray(tickets.status, terminal));
  const totals = db.select({
    totalAll: count(),
    totalOpen: sql<number>`coalesce(sum(${tickets.status} = 'open'), 0)`.mapWith(Number),
    totalInProgress: sql<number>`coalesce(sum(${tickets.status} = 'in_progress'), 0)`.mapWith(Number),
    totalResolved: sql<number>`coalesce(sum(${tickets.status} = 'resolved'), 0)`.mapWith(Number),
    totalClosed: sql<number>`coalesce(sum(${tickets.status} = 'closed'), 0)`.mapWith(Number),
    totalOverdue: sql<number>`coalesce(sum(${overdue}), 0)`.mapWith(Number),
  }).from(tickets).where(where).get()!;
  const countTickets = (condition: SQL | undefined) => db.select({ value: count() }).from(tickets).where(condition).get()!.value;
  const myDepartment = db.select({ id: users.department_id }).from(users).where(eq(users.id, auth.user)).get()?.id;
  const unratedWhere = and(eq(tickets.requester_id, auth.user), sql`${tickets.status} IN ('resolved', 'closed')`,
    sql`NOT EXISTS (SELECT 1 FROM ${csat} WHERE ${csat.ticket_id} = ${tickets.id})`);
  const stats = {
    ...totals,
    totalAssignedToMe: countTickets(and(eq(tickets.assignee_id, auth.user), notInArray(tickets.status, terminal))),
    totalDepartmentUnassigned: myDepartment == null ? 0 : countTickets(and(eq(tickets.department_id, myDepartment), eq(tickets.status, 'open'), isNull(tickets.assignee_id))),
    totalPendingApprovals: db.select({ value: count() }).from(ticketApprovers).where(and(eq(ticketApprovers.approver_id, auth.user), eq(ticketApprovers.status, 'pending'))).get()!.value,
    totalUnrated: countTickets(unratedWhere),
  };
  const sortColumn = tickets[input.sort];
  const sortValue = ['created_at', 'updated_at', 'due_date'].includes(input.sort) ? dateNumber(sortColumn) : sortColumn;
  const order = input.order === 'asc' ? asc : desc;
  const ticketList = db.select().from(tickets).where(where).orderBy(order(sortValue), order(tickets.id)).limit(8).all().map(row => ticketDto(db, row));
  const unratedTickets = db.select().from(tickets).where(unratedWhere).orderBy(desc(dateNumber(tickets.completed_at)), desc(tickets.id)).limit(3).all().map(row => ({
    ...ticketDto(db, row),
    department: row.department_id == null ? undefined : db.select().from(departments).where(eq(departments.id, row.department_id)).get(),
  }));
  const activeUsers = db.select({ ...personFields(users), position: users.position, last_active: users.last_active }).from(users)
    .where(and(eq(users.is_active, true), sql`${dateNumber(users.last_active)} >= ${now.getTime() - 5 * 60_000}`))
    .orderBy(desc(dateNumber(users.last_active))).limit(10).all().filter(row => row.id !== auth.user)
    .map(row => ({ ...row, last_active: row.last_active?.toISOString() }));
  const canApprove = auth.roles.some(role => role === 'admin' || role === 'approver');
  const pendingApprovals = canApprove ? db.select({ approval: ticketApprovers, ticket: tickets }).from(ticketApprovers)
    .innerJoin(tickets, eq(tickets.id, ticketApprovers.ticket_id))
    .where(and(eq(ticketApprovers.approver_id, auth.user), eq(ticketApprovers.status, 'pending')))
    .orderBy(desc(dateNumber(ticketApprovers.created_at)), desc(ticketApprovers.id)).limit(5).all().map(({ approval, ticket }) => ({
      ...approval, status: 'pending' as const, remarks: approval.remarks ?? undefined, decided_at: approval.decided_at?.toISOString(),
      created_at: approval.created_at.toISOString(), ticket: ticketDto(db, ticket),
    })) : [];
  const byPriority = db.select({ name: tickets.priority, count: count() }).from(tickets).where(where).groupBy(tickets.priority).all()
    .map(row => ({ ...row, name: row.name ? row.name[0].toUpperCase() + row.name.slice(1) : 'Unknown' }));
  const byType = db.select({ name: requestTypes.name, count: count() }).from(tickets).leftJoin(requestTypes, eq(requestTypes.id, tickets.request_type_id))
    .where(where).groupBy(tickets.request_type_id).all().map(row => ({ ...row, name: row.name || 'Uncategorized' }));
  const trends = Array.from({ length: 31 }, (_, index) => {
    const day = new Date(now);
    day.setDate(day.getDate() - (30 - index));
    return { date: day.toISOString().slice(0, 10), new: 0, resolved: 0 };
  });
  const since = new Date(now);
  since.setDate(since.getDate() - 30);
  for (const [column, key] of [[tickets.created_at, 'new'], [tickets.completed_at, 'resolved']] as const) {
    const day = sql<string>`strftime('%Y-%m-%d', ${dateNumber(column)} / 1000, 'unixepoch')`;
    const grouped = db.select({ date: day, count: count() }).from(tickets)
      .where(and(where, sql`${dateNumber(column)} >= ${since.getTime()}`, key === 'resolved' ? sql`${tickets.status} IN ('resolved', 'closed')` : undefined))
      .groupBy(day).all();
    for (const entry of grouped) {
      const point = trends.find(point => point.date === entry.date);
      if (point) point[key] = entry.count;
    }
  }
  return { tickets: ticketList, unratedTickets, activeUsers, pendingApprovals, stats, analytics: { trends, byType, byPriority } };
}

export function readTicketReport(db: Db, auth: AuthContext, input: TicketReportQuery) {
  if (!auth.roles.some(role => role === 'admin' || role === 'mis')) error(403, 'Forbidden: Unauthorized access to reports');
  const conditions: SQL[] = [];
  if (input.date_from) conditions.push(sql`${dateNumber(tickets.created_at)} >= ${Date.parse(input.date_from)}`);
  if (input.date_to) conditions.push(sql`${dateNumber(tickets.created_at)} <= ${Date.parse(input.date_to)}`);
  if (input.status) conditions.push(eq(tickets.status, input.status));
  if (input.priority) conditions.push(eq(tickets.priority, input.priority));
  for (const key of ['department_id', 'request_type_id', 'assignee_id', 'requester_id'] as const) {
    if (input[key]) conditions.push(eq(tickets[key], input[key]));
  }
  const requester = alias(users, 'requester');
  const assignee = alias(users, 'assignee');
  const requesterDepartment = alias(departments, 'requester_department');
  const rows = db.select({
    ...getTableColumns(tickets), requester: personFields(requester), requesterDepartment,
    assignee: personFields(assignee), department: departments, request_type: requestTypes, affected_system: affectedSystems, csat,
  }).from(tickets).innerJoin(requester, eq(requester.id, tickets.requester_id))
    .leftJoin(assignee, eq(assignee.id, tickets.assignee_id))
    .leftJoin(requesterDepartment, eq(requesterDepartment.id, requester.department_id))
    .leftJoin(departments, eq(departments.id, tickets.department_id))
    .leftJoin(requestTypes, eq(requestTypes.id, tickets.request_type_id))
    .leftJoin(affectedSystems, eq(affectedSystems.id, tickets.affected_system_id))
    .leftJoin(csat, eq(csat.ticket_id, tickets.id))
    .where(and(...conditions)).orderBy(desc(dateNumber(tickets.created_at)), desc(tickets.id)).all();
  const resolved = rows.filter(row => terminal.includes(row.status));
  const breached = rows.filter(row => row.sla_breached).length;
  const duration = resolved.reduce((sum, row) => sum + (row.started_at && row.completed_at ? row.completed_at.getTime() - row.started_at.getTime() : 0), 0);
  const rated = rows.filter(row => row.csat != null);
  return {
    tickets: rows.map(({ requesterDepartment, ...row }) => ({
      ...row, description: sanitizeRichText(row.description), requester: { ...row.requester, department: requesterDepartment },
      created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(),
      escalated_at: row.escalated_at?.toISOString() ?? null, started_at: row.started_at?.toISOString() ?? null,
      completed_at: row.completed_at?.toISOString() ?? null, due_date: row.due_date?.toISOString() ?? null,
      breached_at: row.breached_at?.toISOString() ?? null,
      csat: row.csat ? { ...row.csat, submitted_at: row.csat.submitted_at.toISOString() } : null,
    })),
    summary: {
      total: rows.length, resolved: resolved.length, sla_breached: breached,
      sla_compliance_rate: rows.length ? Math.round((rows.length - breached) / rows.length * 100) : 100,
      avg_resolution_time_ms: resolved.length ? Math.round(duration / resolved.length) : 0,
      avg_csat_rating: resolved.length && rated.length ? Math.round(rated.reduce((sum, row) => sum + row.csat!.rating, 0) / rated.length * 100) / 100 : 0,
    },
  };
}
