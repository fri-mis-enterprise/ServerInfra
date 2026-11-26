import { z } from 'zod';

const id = z.number().int().positive();
export const dashboardSortSchema = z.enum(['id', 'title', 'status', 'priority', 'created_at', 'updated_at', 'due_date']);
export const dashboardQuerySchema = z.object({
  department_id: id.optional(),
  sort: dashboardSortSchema.default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
}).strict();
const date = z.string().refine(value => value.trim().length > 0 && Number.isFinite(Date.parse(value)), 'Invalid date');
export const ticketReportQuerySchema = z.object({
  date_from: date.optional(),
  date_to: date.optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  department_id: id.optional(),
  request_type_id: id.optional(),
  assignee_id: id.optional(),
  requester_id: id.optional(),
}).strict().refine(input => !input.date_from || !input.date_to || Date.parse(input.date_from) <= Date.parse(input.date_to), {
  message: 'Start date must not follow end date', path: ['date_to'],
});
export type DashboardQuery = z.output<typeof dashboardQuerySchema>;
export type TicketReportQuery = z.output<typeof ticketReportQuerySchema>;
