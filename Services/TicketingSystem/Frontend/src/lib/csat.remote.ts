import { command, query } from "$app/server";
import { requireAuth } from "./server/auth";
import { getDb } from "./server/db";
import {
  readAgentSurveyReport,
  readMyAgentSurveys,
  readSurveyStats,
  readTicketSurvey,
  readUnratedTickets,
  submitSurvey,
} from "./server/csat";
import { broadcaster } from "./server/realtime";
import {
  agentReportSchema,
  csatPageSchema,
  csatStatsSchema,
  csatTicketSchema,
  submitCsatSchema,
} from "./validation/csat";
export const submitCsat = command(submitCsatSchema, async (input) => {
  const auth = await requireAuth();
  const row = submitSurvey(getDb(), auth, input);
  broadcaster.ticketUpdated(input.ticket_id, {
    field: "csat",
    new_value: `${row.rating}/5 stars`,
    updated_by: `Requester #${auth.user}`,
  });
  return row;
});
export const getTicketCsat = query(csatTicketSchema, async (id) =>
  readTicketSurvey(getDb(), await requireAuth(), id),
);
export const getCsatStats = query(csatStatsSchema, async (input) =>
  readSurveyStats(getDb(), await requireAuth(["admin", "mis"]), input),
);
export const getAgentReport = query(agentReportSchema, async (input) =>
  readAgentSurveyReport(getDb(), await requireAuth(["admin", "mis"]), input),
);
export const getMyAgentCsat = query(csatPageSchema, async (input) =>
  readMyAgentSurveys(getDb(), await requireAuth(), input),
);
export const getUnratedTickets = query(async () =>
  readUnratedTickets(getDb(), await requireAuth()),
);
