CREATE TABLE `AffectedSystem` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`department_id` integer,
	FOREIGN KEY (`department_id`) REFERENCES `Department`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `AffectedSystem_name_key` ON `AffectedSystem` (`name`);--> statement-breakpoint
CREATE TABLE `Attachment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`file_url` text NOT NULL,
	`file_size` integer,
	`mime_type` text,
	`type` text DEFAULT 'other' NOT NULL,
	`uploaded_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`ticket_id` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `Ticket`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `Attachment_ticket_id_idx` ON `Attachment` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `AuditLog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`notes` text,
	`created_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`ticket_id` integer,
	`performed_by_id` integer,
	FOREIGN KEY (`ticket_id`) REFERENCES `Ticket`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`performed_by_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `AuditLog_ticket_id_idx` ON `AuditLog` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `CSAT` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rating` integer NOT NULL,
	`rating_speed` integer,
	`rating_attitude` integer,
	`rating_impact` integer,
	`comment` text,
	`resolution_time_ms` integer,
	`submitted_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`ticket_id` integer NOT NULL,
	`agent_id` integer,
	FOREIGN KEY (`ticket_id`) REFERENCES `Ticket`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `CSAT_ticket_id_key` ON `CSAT` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `Department` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Department_name_key` ON `Department` (`name`);--> statement-breakpoint
CREATE TABLE `HardwareItem` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `HardwareItem_name_key` ON `HardwareItem` (`name`);--> statement-breakpoint
CREATE TABLE `Message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content` text NOT NULL,
	`created_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`sender_id` integer NOT NULL,
	`receiver_id` integer NOT NULL,
	`ticket_id` integer,
	FOREIGN KEY (`sender_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`receiver_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`ticket_id`) REFERENCES `Ticket`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `Notification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`read_at` DATETIME,
	`ticket_id` integer,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `Ticket`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `Notification_user_id_idx` ON `Notification` (`user_id`);--> statement-breakpoint
CREATE INDEX `Notification_is_read_idx` ON `Notification` (`is_read`);--> statement-breakpoint
CREATE TABLE `PushSubscription` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `PushSubscription_endpoint_key` ON `PushSubscription` (`endpoint`);--> statement-breakpoint
CREATE TABLE `RequestType` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`requires_approval_by_default` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`department_id` integer,
	FOREIGN KEY (`department_id`) REFERENCES `Department`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `RequestType_name_key` ON `RequestType` (`name`);--> statement-breakpoint
CREATE TABLE `ResolutionAttempt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attempt_number` integer NOT NULL,
	`notes` text,
	`resolved_at` DATETIME,
	`reopened_at` DATETIME,
	`reopen_reason` text,
	`created_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`ticket_id` integer NOT NULL,
	`handled_by_id` integer,
	FOREIGN KEY (`ticket_id`) REFERENCES `Ticket`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`handled_by_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ResolutionAttempt_ticket_id_idx` ON `ResolutionAttempt` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `TicketApprover` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`remarks` text,
	`decided_at` DATETIME,
	`created_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`ticket_id` integer NOT NULL,
	`approver_id` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `Ticket`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`approver_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `TicketApprover_ticket_id_approver_id_key` ON `TicketApprover` (`ticket_id`,`approver_id`);--> statement-breakpoint
CREATE INDEX `TicketApprover_ticket_id_idx` ON `TicketApprover` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `TicketApprover_approver_id_idx` ON `TicketApprover` (`approver_id`);--> statement-breakpoint
CREATE TABLE `TicketComment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content` text NOT NULL,
	`is_internal` integer DEFAULT false NOT NULL,
	`created_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`updated_at` DATETIME NOT NULL,
	`ticket_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `Ticket`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `TicketComment_ticket_id_idx` ON `TicketComment` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `Ticket` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`reopen_count` integer DEFAULT 0 NOT NULL,
	`requires_approval` integer DEFAULT false NOT NULL,
	`escalated_to_approval` integer DEFAULT false NOT NULL,
	`escalated_at` DATETIME,
	`escalated_by_id` integer,
	`started_at` DATETIME,
	`completed_at` DATETIME,
	`due_date` DATETIME,
	`sla_breached` integer DEFAULT false NOT NULL,
	`breached_at` DATETIME,
	`created_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`updated_at` DATETIME NOT NULL,
	`department_id` integer,
	`requester_id` integer NOT NULL,
	`assignee_id` integer,
	`request_type_id` integer,
	`affected_system_id` integer,
	`hardware_item_id` integer,
	`other_request_type` text,
	`other_affected_system` text,
	`other_department` text,
	FOREIGN KEY (`department_id`) REFERENCES `Department`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`requester_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`assignee_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`request_type_id`) REFERENCES `RequestType`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`affected_system_id`) REFERENCES `AffectedSystem`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`hardware_item_id`) REFERENCES `HardwareItem`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `Ticket_status_idx` ON `Ticket` (`status`);--> statement-breakpoint
CREATE INDEX `Ticket_priority_idx` ON `Ticket` (`priority`);--> statement-breakpoint
CREATE INDEX `Ticket_requester_id_idx` ON `Ticket` (`requester_id`);--> statement-breakpoint
CREATE INDEX `Ticket_assignee_id_idx` ON `Ticket` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `Ticket_department_id_idx` ON `Ticket` (`department_id`);--> statement-breakpoint
CREATE INDEX `Ticket_request_type_id_idx` ON `Ticket` (`request_type_id`);--> statement-breakpoint
CREATE INDEX `Ticket_affected_system_id_idx` ON `Ticket` (`affected_system_id`);--> statement-breakpoint
CREATE INDEX `Ticket_due_date_idx` ON `Ticket` (`due_date`);--> statement-breakpoint
CREATE INDEX `Ticket_created_at_idx` ON `Ticket` (`created_at`);--> statement-breakpoint
CREATE TABLE `UserRole` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`assigned_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UserRole_user_id_role_key` ON `UserRole` (`user_id`,`role`);--> statement-breakpoint
CREATE TABLE `User` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`position` text,
	`message_notifications` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_active` DATETIME,
	`created_at` DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) NOT NULL,
	`updated_at` DATETIME NOT NULL,
	`department_id` integer,
	FOREIGN KEY (`department_id`) REFERENCES `Department`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `User_email_key` ON `User` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `User_username_key` ON `User` (`username`);