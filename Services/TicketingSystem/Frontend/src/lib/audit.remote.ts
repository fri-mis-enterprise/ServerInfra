import { query } from '$app/server';
import { requireAuth } from './server/auth';
import { getDb } from './server/db';
import { readAudit, readTicketAuditTrail } from './server/audit-reads';
import { auditFilterSchema, ticketAuditIdSchema } from './validation/audit';

export const getTicketAudit = query(auditFilterSchema, async input => readAudit(getDb(), await requireAuth(['admin', 'mis']), input, 'ticket'));
export const getAuthAudit = query(auditFilterSchema, async input => readAudit(getDb(), await requireAuth(['admin', 'mis']), input, 'auth'));
export const getTicketAuditTrail = query(ticketAuditIdSchema, async id => readTicketAuditTrail(getDb(), await requireAuth(), id));
