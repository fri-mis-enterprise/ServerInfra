import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrateDatabase } from "./db/migrate";
import type { getDb } from "./db";
import { auditLogs, csat, tickets, users } from "./db/schema";
import {
  readAgentSurveyReport,
  readMyAgentSurveys,
  readSurveyStats,
  readTicketSurvey,
  readUnratedTickets,
  submitSurvey,
} from "./csat";
import {
  agentReportSchema,
  csatPageSchema,
  csatStatsSchema,
  submitCsatSchema,
} from "../validation/csat";
let sqlite: Database, db: ReturnType<typeof getDb>;
const owner = { user: 1, roles: ["user"] },
  staff = { user: 2, roles: ["mis"] };
function status(run: () => unknown, code: number) {
  try {
    run();
    throw new Error("Expected rejection");
  } catch (err) {
    expect(err).toMatchObject({ status: code });
  }
}
beforeEach(() => {
  sqlite = new Database(":memory:");
  migrateDatabase(sqlite);
  sqlite.exec("PRAGMA foreign_keys=ON");
  db = drizzle(sqlite);
  db.insert(users)
    .values(
      [1, 2, 3].map((id) => ({
        id,
        first_name: `User${id}`,
        last_name: "Test",
        email: `u${id}@example.com`,
        username: `user${id}`,
        password: "private",
      })),
    )
    .run();
  db.insert(tickets)
    .values({
      id: 1,
      title: "Resolved",
      description: "Description",
      requester_id: 1,
      assignee_id: 2,
      status: "resolved",
      started_at: new Date("2026-11-01T00:00:00Z"),
      completed_at: new Date("2026-11-01T01:00:00Z"),
    })
    .run();
});
afterEach(() => sqlite.close());
test("CSAT ownership, lifecycle, duplicate and rating boundaries retain one atomic survey/audit", () => {
  const input = submitCsatSchema.parse({
    ticket_id: 1,
    rating_speed: 5,
    rating_attitude: 4,
    rating_impact: 3,
    comment: "Thanks",
  });
  status(() => submitSurvey(db, { user: 3, roles: ["user"] }, input), 403);
  expect(readUnratedTickets(db, owner)).toHaveLength(1);
  const row = submitSurvey(db, owner, input);
  expect(row.rating).toBe(4);
  expect(row.resolution_time_ms).toBe(3600000);
  expect(row.agent_id).toBe(2);
  expect(readUnratedTickets(db, owner)).toHaveLength(0);
  status(() => submitSurvey(db, owner, input), 409);
  expect(readTicketSurvey(db, owner, 1).id).toBe(row.id);
  status(() => readTicketSurvey(db, { user: 3, roles: ["user"] }, 1), 403);
  expect(db.select().from(csat).all()).toHaveLength(1);
  expect(db.select().from(auditLogs).all()).toHaveLength(1);
  expect(
    submitCsatSchema.safeParse({ ...input, rating_speed: 6 }).success,
  ).toBe(false);
});
test("CSAT stats and agent report preserve aggregates and restrict staff reports", () => {
  const empty = readSurveyStats(db, staff, {});
  expect(empty.total_responses).toBe(0);
  expect(empty.sla_impact).toEqual({ breached: 0, met: 0 });
  submitSurvey(db, owner, {
    ticket_id: 1,
    rating_speed: 5,
    rating_attitude: 4,
    rating_impact: 3,
  });
  const stats = readSurveyStats(db, staff, {});
  expect(stats.average_rating).toBe(4);
  expect(stats.distribution[4]).toBe(1);
  expect(stats.agent_leaderboard[0]).toMatchObject({
    agent_id: 2,
    average: 4,
    count: 1,
  });
  const report = readAgentSurveyReport(db, staff, { agent_id: 2 });
  expect(report.agent).not.toHaveProperty("password");
  expect(report.summary).toMatchObject({
    total_responses: 1,
    total_assigned_tickets: 1,
    total_resolved_tickets: 1,
    sla_compliance_rate: 100,
    avg_resolution_time_ms: 3600000,
  });
  expect(
    readMyAgentSurveys(db, staff, csatPageSchema.parse({})).pagination.total,
  ).toBe(1);
  status(() => readSurveyStats(db, owner, {}), 403);
  status(() => readAgentSurveyReport(db, owner, { agent_id: 2 }), 403);
  expect(csatStatsSchema.safeParse({ month: "2026-13" }).success).toBe(false);
  expect(agentReportSchema.safeParse({ agent_id: 0 }).success).toBe(false);
});

test("CSAT monthly ranges, missing agents and mixed timestamp encodings retain statistics", () => {
  submitSurvey(db, owner, {
    ticket_id: 1,
    rating_speed: 5,
    rating_attitude: 5,
    rating_impact: 5,
  });
  db.insert(tickets)
    .values({
      id: 2,
      title: "Unassigned resolved",
      description: "Description",
      requester_id: 1,
      status: "closed",
      sla_breached: true,
    })
    .run();
  submitSurvey(db, owner, {
    ticket_id: 2,
    rating_speed: 1,
    rating_attitude: 1,
    rating_impact: 1,
  });
  sqlite
    .query("UPDATE CSAT SET submitted_at=? WHERE ticket_id=1")
    .run(new Date("2026-11-02T00:00:00Z").getTime());
  sqlite
    .query("UPDATE CSAT SET submitted_at=? WHERE ticket_id=2")
    .run("2026-11-03 00:00:00");
  const stats = readSurveyStats(db, staff, { month: "2026-11" });
  expect(stats).toMatchObject({
    average_rating: 3,
    total_responses: 2,
    sla_impact: { met: 5, breached: 1 },
  });
  expect(stats.trend).toEqual([
    { date: "2026-11-02", average: 5 },
    { date: "2026-11-03", average: 1 },
  ]);
  expect(stats.agent_leaderboard).toHaveLength(1);
  expect(readSurveyStats(db, staff, { month: "2026-12" }).total_responses).toBe(
    0,
  );
  expect(
    readSurveyStats(db, staff, {
      start_date: "2026-11-03",
      end_date: "2026-11-04",
    }).total_responses,
  ).toBe(1);
  expect(readSurveyStats(db, staff, { agent_id: 2 }).total_responses).toBe(1);
});
