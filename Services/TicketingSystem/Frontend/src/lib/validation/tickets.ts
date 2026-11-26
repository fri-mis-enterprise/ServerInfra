import { z } from 'zod';

export const ticketIdSchema = z.number().int().positive();
export const ticketListSchema = z.object({
  scope: z.enum(['all', 'requested', 'assigned']).default('all'),
  status: z.string().optional(),
  priority: z.string().optional(),
  assignee_id: z.coerce.number().int().positive().optional(),
  requester_id: z.coerce.number().int().positive().optional(),
  affected_system_id: z.coerce.number().int().positive().optional(),
  request_type_id: z.coerce.number().int().positive().optional(),
  department_id: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  overdue: z.enum(['true', 'false']).optional(),
  unrated: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['id', 'title', 'status', 'priority', 'created_at', 'updated_at', 'due_date']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
}).strict();

export type TicketListInput = z.infer<typeof ticketListSchema>;
