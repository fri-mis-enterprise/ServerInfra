import { z } from 'zod';

export const auditFilterSchema = z.object({
  ticket_id: z.number().int().positive().optional(),
  performed_by_id: z.number().int().positive().optional(),
  action: z.string().max(255).optional(),
  exclude_action: z.string().max(255).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
export const ticketAuditIdSchema = z.number().int().positive();
