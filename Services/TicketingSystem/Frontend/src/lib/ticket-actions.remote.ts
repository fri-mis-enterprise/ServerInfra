import { command } from '$app/server';
import { getDb } from './server/db';
import { requireAuth } from './server/auth';
import * as writes from './server/ticket-writes';
import { deliverNotifications } from './server/notifications';
import { addApproversSchema, createCommentSchema, createTicketSchema, decisionSchema, idSchema, removeApproverSchema, toggleApproverSchema, updateCommentSchema, updateTicketSchema } from './validation/ticket-writes';

async function finish<T>(result: { value: T; notifications: Parameters<typeof deliverNotifications>[0] }) {
  await deliverNotifications(result.notifications);
  return result.value;
}
export const createTicket = command(createTicketSchema, async input => finish(writes.createTicket(getDb(), await requireAuth(), input)));
export const updateTicket = command(updateTicketSchema, async input => finish(writes.updateTicket(getDb(), await requireAuth(), input.id, input.data)));
export const escalateTicket = command(idSchema, async id => finish(writes.escalateTicket(getDb(), await requireAuth(['admin', 'mis']), id)));
export const toggleTicketApprover = command(toggleApproverSchema, async input => finish(writes.toggleTicketApprover(getDb(), await requireAuth(['admin', 'mis']), input.id, input.approver_id)));
export const addTicketApprovers = command(addApproversSchema, async input => finish(writes.addTicketApprovers(getDb(), await requireAuth(['admin', 'mis']), input.ticket_id, input.approver_ids)));
export const removeTicketApprover = command(removeApproverSchema, async input => finish(writes.removeTicketApprover(getDb(), await requireAuth(['admin', 'mis']), input.ticket_id, input.id)));
export const decideApproval = command(decisionSchema, async input => finish(writes.decideApproval(getDb(), await requireAuth(['admin', 'mis', 'approver']), input)));
export const createComment = command(createCommentSchema, async input => finish(writes.createComment(getDb(), await requireAuth(), input)));
export const updateComment = command(updateCommentSchema, async input => finish(writes.updateComment(getDb(), await requireAuth(), input.id, input.data)));
export const deleteComment = command(idSchema, async id => finish(writes.deleteComment(getDb(), await requireAuth(), id)));
