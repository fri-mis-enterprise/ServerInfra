-- CreateIndex
CREATE INDEX "Attachment_ticket_id_idx" ON "Attachment"("ticket_id");

-- CreateIndex
CREATE INDEX "AuditLog_ticket_id_idx" ON "AuditLog"("ticket_id");

-- CreateIndex
CREATE INDEX "Notification_user_id_idx" ON "Notification"("user_id");

-- CreateIndex
CREATE INDEX "Notification_is_read_idx" ON "Notification"("is_read");

-- CreateIndex
CREATE INDEX "ResolutionAttempt_ticket_id_idx" ON "ResolutionAttempt"("ticket_id");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_priority_idx" ON "Ticket"("priority");

-- CreateIndex
CREATE INDEX "Ticket_requester_id_idx" ON "Ticket"("requester_id");

-- CreateIndex
CREATE INDEX "Ticket_assignee_id_idx" ON "Ticket"("assignee_id");

-- CreateIndex
CREATE INDEX "Ticket_department_id_idx" ON "Ticket"("department_id");

-- CreateIndex
CREATE INDEX "Ticket_request_type_id_idx" ON "Ticket"("request_type_id");

-- CreateIndex
CREATE INDEX "Ticket_affected_system_id_idx" ON "Ticket"("affected_system_id");

-- CreateIndex
CREATE INDEX "Ticket_due_date_idx" ON "Ticket"("due_date");

-- CreateIndex
CREATE INDEX "Ticket_created_at_idx" ON "Ticket"("created_at");

-- CreateIndex
CREATE INDEX "TicketApprover_ticket_id_idx" ON "TicketApprover"("ticket_id");

-- CreateIndex
CREATE INDEX "TicketApprover_approver_id_idx" ON "TicketApprover"("approver_id");

-- CreateIndex
CREATE INDEX "TicketComment_ticket_id_idx" ON "TicketComment"("ticket_id");
