import { query } from '$app/server';
import { requireAuth } from './server/auth';
import { getDb } from './server/db';
import { listPendingApprovals, listTicketApprovers, listTickets, readTicket, readTicketPreview } from './server/ticket-reads';
import { ticketIdSchema, ticketListSchema } from './validation/tickets';

export const getTickets = query(ticketListSchema, async input => listTickets(getDb(), await requireAuth(), input));
export const getTicket = query(ticketIdSchema, async id => readTicket(getDb(), await requireAuth(), id));
export const getTicketPreview = query(ticketIdSchema, async id => readTicketPreview(getDb(), await requireAuth(), id));
export const getTicketApprovers = query(ticketIdSchema, async id => listTicketApprovers(getDb(), await requireAuth(), id));
export const getPendingApprovals = query(async () => listPendingApprovals(getDb(), await requireAuth()));
