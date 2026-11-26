import { error } from "@sveltejs/kit";
import {
  and,
  count,
  desc,
  eq,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type { z } from "zod";
import type { AuthContext } from "./auth";
import type { getDb } from "./db";
import { auditLogs, csat, departments, tickets, users } from "./db/schema";
import { sqliteDateMillis } from "./db/date";
import { loadUser, readTicket, ticketDto } from "./ticket-reads";
import type {
  agentReportSchema,
  csatPageSchema,
  csatStatsSchema,
  submitCsatSchema,
} from "../validation/csat";
type Db = ReturnType<typeof getDb>;
type CsatRow = typeof csat.$inferSelect;
function staff(auth: AuthContext) {
  if (!auth.roles.some((role) => role === "admin" || role === "mis"))
    error(403, "Access denied");
}
const dto = (row: CsatRow) => ({
  ...row,
  submitted_at: row.submitted_at.toISOString(),
});
function range(
  column: SQLWrapper,
  input: { month?: string; start_date?: string; end_date?: string },
): SQL | undefined {
  if (input.month) {
    const [year, month] = input.month.split("-").map(Number);
    return and(
      sql`${sqliteDateMillis(column)} >= ${new Date(year, month - 1, 1).getTime()}`,
      sql`${sqliteDateMillis(column)} < ${new Date(year, month, 1).getTime()}`,
    );
  }
  return and(
    input.start_date
      ? sql`${sqliteDateMillis(column)} >= ${Date.parse(input.start_date)}`
      : undefined,
    input.end_date
      ? sql`${sqliteDateMillis(column)} <= ${Date.parse(input.end_date)}`
      : undefined,
  );
}
export function submitSurvey(
  db: Db,
  auth: AuthContext,
  input: z.output<typeof submitCsatSchema>,
) {
  return db.transaction((tx) => {
    const ticket = tx
      .select()
      .from(tickets)
      .where(eq(tickets.id, input.ticket_id))
      .get();
    if (!ticket) error(404, "Ticket not found");
    if (ticket.requester_id !== auth.user)
      error(403, "Only the ticket requester can submit CSAT");
    if (!["resolved", "closed"].includes(ticket.status))
      error(400, "CSAT can only be submitted for resolved or closed tickets");
    if (
      tx
        .select({ id: csat.id })
        .from(csat)
        .where(eq(csat.ticket_id, ticket.id))
        .get()
    )
      error(409, "CSAT already submitted for this ticket");
    const rating = Math.round(
      (input.rating_speed + input.rating_attitude + input.rating_impact) / 3,
    );
    const row = tx
      .insert(csat)
      .values({
        ...input,
        rating,
        agent_id: ticket.assignee_id,
        resolution_time_ms:
          ticket.started_at && ticket.completed_at
            ? ticket.completed_at.getTime() - ticket.started_at.getTime()
            : null,
      })
      .returning()
      .get()!;
    tx.insert(auditLogs)
      .values({
        ticket_id: ticket.id,
        performed_by_id: auth.user,
        action: "csat_submitted",
        new_value: `Rating: ${rating}/5`,
        notes: input.comment,
      })
      .run();
    return dto(row);
  });
}
export function readTicketSurvey(db: Db, auth: AuthContext, id: number) {
  readTicket(db, auth, id);
  const row = db.select().from(csat).where(eq(csat.ticket_id, id)).get();
  if (!row) error(404, "CSAT not submitted for this ticket");
  return dto(row);
}
export function readSurveyStats(
  db: Db,
  auth: AuthContext,
  input: z.output<typeof csatStatsSchema>,
) {
  staff(auth);
  const rows = db
    .select({
      survey: csat,
      ticket: {
        priority: tickets.priority,
        sla_breached: tickets.sla_breached,
      },
      agent: { first_name: users.first_name, last_name: users.last_name },
    })
    .from(csat)
    .innerJoin(tickets, eq(tickets.id, csat.ticket_id))
    .leftJoin(users, eq(users.id, csat.agent_id))
    .where(
      and(
        input.agent_id ? eq(csat.agent_id, input.agent_id) : undefined,
        range(csat.submitted_at, input),
      ),
    )
    .all();
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const agents = new Map<
    number,
    { sum: number; count: number; name: string }
  >();
  const trends = new Map<string, { sum: number; count: number }>();
  let sum = 0,
    breached = 0,
    met = 0,
    breachedCount = 0,
    metCount = 0;
  for (const { survey: row, ticket, agent } of rows) {
    sum += row.rating;
    distribution[row.rating] = (distribution[row.rating] ?? 0) + 1;
    if (ticket.sla_breached) {
      breached += row.rating;
      breachedCount++;
    } else {
      met += row.rating;
      metCount++;
    }
    const day = row.submitted_at.toISOString().slice(0, 10),
      trend = trends.get(day) ?? { sum: 0, count: 0 };
    trend.sum += row.rating;
    trend.count++;
    trends.set(day, trend);
    if (row.agent_id) {
      const entry = agents.get(row.agent_id) ?? {
        sum: 0,
        count: 0,
        name: `${agent?.first_name ?? ""} ${agent?.last_name ?? ""}`.trim(),
      };
      entry.sum += row.rating;
      entry.count++;
      agents.set(row.agent_id, entry);
    }
  }
  return {
    average_rating: rows.length
      ? Math.round((sum / rows.length) * 100) / 100
      : 0,
    total_responses: rows.length,
    distribution,
    trend: [...trends]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, average: value.sum / value.count })),
    agent_leaderboard: [...agents]
      .map(([agent_id, value]) => ({
        agent_id,
        name: value.name,
        average: value.sum / value.count,
        count: value.count,
      }))
      .sort((a, b) => b.average - a.average || a.agent_id - b.agent_id)
      .slice(0, 50),
    dimension_breakdown: { departments: {}, priorities: {} },
    sla_impact: {
      breached: breached / (breachedCount || 1),
      met: met / (metCount || 1),
    },
  };
}
export function readAgentSurveyReport(
  db: Db,
  auth: AuthContext,
  input: z.output<typeof agentReportSchema>,
) {
  staff(auth);
  const agent = loadUser(db, input.agent_id);
  if (!agent) error(404, "Agent not found");
  const rows = db
    .select({ survey: csat, ticket: tickets })
    .from(csat)
    .innerJoin(tickets, eq(tickets.id, csat.ticket_id))
    .where(
      and(eq(csat.agent_id, input.agent_id), range(csat.submitted_at, input)),
    )
    .orderBy(desc(sqliteDateMillis(csat.submitted_at)), desc(csat.id))
    .all();
  const countTickets = (where: SQL | undefined) =>
    db
      .select({ total: count() })
      .from(tickets)
      .where(and(eq(tickets.assignee_id, input.agent_id), where))
      .get()!.total;
  const resolved = sql`${tickets.status} IN ('resolved','closed')`;
  const totalAssigned = countTickets(range(tickets.created_at, input));
  const totalResolved = countTickets(
    and(resolved, range(tickets.completed_at, input)),
  );
  const totalSlaMet = countTickets(
    and(
      resolved,
      eq(tickets.sla_breached, false),
      range(tickets.completed_at, input),
    ),
  );
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    priority_breakdown: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
  let sum = 0,
    duration = 0,
    timed = 0;
  for (const { survey, ticket } of rows) {
    sum += survey.rating;
    distribution[survey.rating] = (distribution[survey.rating] ?? 0) + 1;
    priority_breakdown[ticket.priority] =
      (priority_breakdown[ticket.priority] ?? 0) + 1;
    if (survey.resolution_time_ms) {
      duration += survey.resolution_time_ms;
      timed++;
    }
  }
  return {
    agent,
    summary: {
      average_rating: rows.length
        ? Math.round((sum / rows.length) * 100) / 100
        : 0,
      total_responses: rows.length,
      total_assigned_tickets: totalAssigned,
      total_resolved_tickets: totalResolved,
      sla_compliance_rate: totalResolved
        ? Math.round((totalSlaMet / totalResolved) * 100)
        : 0,
      avg_resolution_time_ms: timed ? Math.round(duration / timed) : 0,
    },
    distribution,
    priority_breakdown,
    recent_feedback: rows.slice(0, 50).map(({ survey, ticket }) => ({
      id: survey.id,
      rating: survey.rating,
      comment: survey.comment,
      submitted_at: survey.submitted_at.toISOString(),
      ticket: {
        id: ticket.id,
        title: ticket.title,
        priority: ticket.priority,
        sla_breached: ticket.sla_breached,
      },
    })),
  };
}
export function readMyAgentSurveys(
  db: Db,
  auth: AuthContext,
  input: z.output<typeof csatPageSchema>,
) {
  const where = eq(csat.agent_id, auth.user),
    total = db.select({ total: count() }).from(csat).where(where).get()!.total;
  const rows = db
    .select({
      survey: csat,
      ticket: { id: tickets.id, title: tickets.title, status: tickets.status },
    })
    .from(csat)
    .innerJoin(tickets, eq(tickets.id, csat.ticket_id))
    .where(where)
    .orderBy(desc(sqliteDateMillis(csat.submitted_at)), desc(csat.id))
    .limit(input.limit)
    .offset((input.page - 1) * input.limit)
    .all();
  return {
    data: rows.map(({ survey, ticket }) => ({ ...dto(survey), ticket })),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      pages: Math.ceil(total / input.limit),
    },
  };
}
export function readUnratedTickets(db: Db, auth: AuthContext) {
  return db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.requester_id, auth.user),
        sql`${tickets.status} IN ('resolved','closed')`,
        sql`NOT EXISTS (SELECT 1 FROM ${csat} WHERE ${csat.ticket_id}=${tickets.id})`,
      ),
    )
    .orderBy(desc(sqliteDateMillis(tickets.completed_at)), desc(tickets.id))
    .all()
    .map((row) => ({
      ...ticketDto(db, row),
      department:
        row.department_id === null
          ? undefined
          : db
              .select({ id: departments.id, name: departments.name })
              .from(departments)
              .where(eq(departments.id, row.department_id))
              .get(),
    }));
}
