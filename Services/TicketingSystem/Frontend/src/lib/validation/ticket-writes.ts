import { z } from 'zod';

export const idSchema = z.number().int().positive();
export const statusSchema = z.enum(['open', 'in_progress', 'pending_approval', 'pending_hard_copy', 'resolved', 'closed', 'rejected']);
export const prioritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const ticketStatusSchema = statusSchema;
export const ticketPrioritySchema = prioritySchema;
const text = z.string().trim().min(1);
const date = z.iso.datetime({ offset: true });
const references = {
  department_id: idSchema.nullable().optional(), request_type_id: idSchema.nullable().optional(),
  affected_system_id: idSchema.nullable().optional(), hardware_item_id: idSchema.nullable().optional(),
};
const others = {
  other_request_type: z.string().nullable().optional(), other_affected_system: z.string().nullable().optional(),
  other_department: z.string().nullable().optional(),
};
export const createTicketSchema = z.object({
  title: text.min(5), description: text.min(20), priority: prioritySchema.optional(), ...references,
  requires_approval: z.boolean().optional(), due_date: date.optional(), ...others,
}).strict();
export const ticketChangesSchema = z.object({
  title: text.optional(), description: text.optional(), priority: prioritySchema.optional(), ...references, ...others,
  status: statusSchema.optional(), assignee_id: idSchema.nullable().optional(), due_date: date.nullable().optional(),
  reopen_reason: z.string().optional(), resolution_notes: z.string().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'No fields to update');
export const updateTicketSchema = z.object({ id: idSchema, data: ticketChangesSchema }).strict();
export const toggleApproverSchema = z.object({ id: idSchema, approver_id: idSchema }).strict();
export const addApproversSchema = z.object({ ticket_id: idSchema, approver_ids: z.array(idSchema).min(1).max(100) }).strict();
export const removeApproverSchema = z.object({ id: idSchema, ticket_id: idSchema }).strict();
export const decisionSchema = z.object({ id: idSchema, ticket_id: idSchema, decision: z.enum(['approved', 'rejected']), remarks: z.string().optional() }).strict();
export const createCommentSchema = z.object({ ticket_id: idSchema, content: text, is_internal: z.boolean().optional() }).strict();
export const commentChangesSchema = z.object({ content: text.optional(), is_internal: z.boolean().optional() }).strict()
  .refine(value => Object.keys(value).length > 0, 'No fields to update');
export const updateCommentSchema = z.object({ id: idSchema, data: commentChangesSchema }).strict();
