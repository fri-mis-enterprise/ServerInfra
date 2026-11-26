import { query } from '$app/server';
import { requireAuth } from './server/auth';
import { getDb } from './server/db';
import { readDashboardSummary, readTicketReport } from './server/report-reads';
import { dashboardQuerySchema, ticketReportQuerySchema } from './validation/reports';

export const getDashboardSummary = query(dashboardQuerySchema, async input =>
  readDashboardSummary(getDb(), await requireAuth(), input));
export const getTicketReport = query(ticketReportQuerySchema, async input =>
  readTicketReport(getDb(), await requireAuth(['admin', 'mis']), input));
