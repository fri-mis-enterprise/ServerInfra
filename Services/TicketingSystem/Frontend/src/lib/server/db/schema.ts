import { sqliteTable, integer, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sqliteDate, sqliteNow } from "./date";

export const departments = sqliteTable(
  "Department",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [uniqueIndex("Department_name_key").on(table.name)],
);

export const affectedSystems = sqliteTable(
  "AffectedSystem",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
    department_id: integer("department_id").references(() => departments.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [uniqueIndex("AffectedSystem_name_key").on(table.name)],
);

export const requestTypes = sqliteTable(
  "RequestType",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    requires_approval_by_default: integer("requires_approval_by_default", { mode: "boolean" }).notNull().default(false),
    is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
    department_id: integer("department_id").references(() => departments.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [uniqueIndex("RequestType_name_key").on(table.name)],
);

export const hardwareItems = sqliteTable(
  "HardwareItem",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [uniqueIndex("HardwareItem_name_key").on(table.name)],
);

export const users = sqliteTable(
  "User",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    first_name: text("first_name").notNull(),
    last_name: text("last_name").notNull(),
    email: text("email").notNull(),
    username: text("username").notNull(),
    password: text("password").notNull(),
    position: text("position"),
    message_notifications: integer("message_notifications", { mode: "boolean" }).notNull().default(true),
    is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
    last_active: sqliteDate("last_active"),
    created_at: sqliteDate("created_at").notNull().default(sqliteNow),
    updated_at: sqliteDate("updated_at").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
    department_id: integer("department_id").references(() => departments.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    uniqueIndex("User_email_key").on(table.email),
    uniqueIndex("User_username_key").on(table.username),
  ],
);

export const pushSubscriptions = sqliteTable(
  "PushSubscription",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    created_at: sqliteDate("created_at").notNull().default(sqliteNow),
    user_id: integer("user_id").notNull().references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  },
  (table) => [uniqueIndex("PushSubscription_endpoint_key").on(table.endpoint)],
);

export const userRoles = sqliteTable(
  "UserRole",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    role: text("role").notNull(),
    assigned_at: sqliteDate("assigned_at").notNull().default(sqliteNow),
    user_id: integer("user_id").notNull().references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [uniqueIndex("UserRole_user_id_role_key").on(table.user_id, table.role)],
);

export const tickets = sqliteTable(
  "Ticket",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("medium"),
    reopen_count: integer("reopen_count").notNull().default(0),
    requires_approval: integer("requires_approval", { mode: "boolean" }).notNull().default(false),
    escalated_to_approval: integer("escalated_to_approval", { mode: "boolean" }).notNull().default(false),
    escalated_at: sqliteDate("escalated_at"),
    escalated_by_id: integer("escalated_by_id"),
    started_at: sqliteDate("started_at"),
    completed_at: sqliteDate("completed_at"),
    due_date: sqliteDate("due_date"),
    sla_breached: integer("sla_breached", { mode: "boolean" }).notNull().default(false),
    breached_at: sqliteDate("breached_at"),
    created_at: sqliteDate("created_at").notNull().default(sqliteNow),
    updated_at: sqliteDate("updated_at").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
    department_id: integer("department_id").references(() => departments.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    requester_id: integer("requester_id").notNull().references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    assignee_id: integer("assignee_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    request_type_id: integer("request_type_id").references(() => requestTypes.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    affected_system_id: integer("affected_system_id").references(() => affectedSystems.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    hardware_item_id: integer("hardware_item_id").references(() => hardwareItems.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    other_request_type: text("other_request_type"),
    other_affected_system: text("other_affected_system"),
    other_department: text("other_department"),
  },
  (table) => [
    index("Ticket_status_idx").on(table.status),
    index("Ticket_priority_idx").on(table.priority),
    index("Ticket_requester_id_idx").on(table.requester_id),
    index("Ticket_assignee_id_idx").on(table.assignee_id),
    index("Ticket_department_id_idx").on(table.department_id),
    index("Ticket_request_type_id_idx").on(table.request_type_id),
    index("Ticket_affected_system_id_idx").on(table.affected_system_id),
    index("Ticket_due_date_idx").on(table.due_date),
    index("Ticket_created_at_idx").on(table.created_at),
  ],
);

export const messages = sqliteTable("Message", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  content: text("content").notNull(),
  created_at: sqliteDate("created_at").notNull().default(sqliteNow),
  is_read: integer("is_read", { mode: "boolean" }).notNull().default(false),
  sender_id: integer("sender_id").notNull().references(() => users.id, {
    onDelete: "restrict",
    onUpdate: "cascade",
  }),
  receiver_id: integer("receiver_id").notNull().references(() => users.id, {
    onDelete: "restrict",
    onUpdate: "cascade",
  }),
  ticket_id: integer("ticket_id").references(() => tickets.id, {
    onDelete: "set null",
    onUpdate: "cascade",
  }),
});

export const ticketApprovers = sqliteTable(
  "TicketApprover",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    status: text("status").notNull().default("pending"),
    remarks: text("remarks"),
    decided_at: sqliteDate("decided_at"),
    created_at: sqliteDate("created_at").notNull().default(sqliteNow),
    ticket_id: integer("ticket_id").notNull().references(() => tickets.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    approver_id: integer("approver_id").notNull().references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    uniqueIndex("TicketApprover_ticket_id_approver_id_key").on(table.ticket_id, table.approver_id),
    index("TicketApprover_ticket_id_idx").on(table.ticket_id),
    index("TicketApprover_approver_id_idx").on(table.approver_id),
  ],
);

export const attachments = sqliteTable(
  "Attachment",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    file_name: text("file_name").notNull(),
    file_url: text("file_url").notNull(),
    file_size: integer("file_size"),
    mime_type: text("mime_type"),
    type: text("type").notNull().default("other"),
    uploaded_at: sqliteDate("uploaded_at").notNull().default(sqliteNow),
    ticket_id: integer("ticket_id").notNull().references(() => tickets.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [index("Attachment_ticket_id_idx").on(table.ticket_id)],
);

export const resolutionAttempts = sqliteTable(
  "ResolutionAttempt",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    attempt_number: integer("attempt_number").notNull(),
    notes: text("notes"),
    resolved_at: sqliteDate("resolved_at"),
    reopened_at: sqliteDate("reopened_at"),
    reopen_reason: text("reopen_reason"),
    created_at: sqliteDate("created_at").notNull().default(sqliteNow),
    ticket_id: integer("ticket_id").notNull().references(() => tickets.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    handled_by_id: integer("handled_by_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [index("ResolutionAttempt_ticket_id_idx").on(table.ticket_id)],
);

export const auditLogs = sqliteTable(
  "AuditLog",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    action: text("action").notNull(),
    old_value: text("old_value"),
    new_value: text("new_value"),
    notes: text("notes"),
    created_at: sqliteDate("created_at").notNull().default(sqliteNow),
    ticket_id: integer("ticket_id").references(() => tickets.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    performed_by_id: integer("performed_by_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [index("AuditLog_ticket_id_idx").on(table.ticket_id)],
);

export const notifications = sqliteTable(
  "Notification",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    is_read: integer("is_read", { mode: "boolean" }).notNull().default(false),
    created_at: sqliteDate("created_at").notNull().default(sqliteNow),
    read_at: sqliteDate("read_at"),
    ticket_id: integer("ticket_id").references(() => tickets.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    user_id: integer("user_id").notNull().references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("Notification_user_id_idx").on(table.user_id),
    index("Notification_is_read_idx").on(table.is_read),
  ],
);

export const ticketComments = sqliteTable(
  "TicketComment",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    content: text("content").notNull(),
    is_internal: integer("is_internal", { mode: "boolean" }).notNull().default(false),
    created_at: sqliteDate("created_at").notNull().default(sqliteNow),
    updated_at: sqliteDate("updated_at").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
    ticket_id: integer("ticket_id").notNull().references(() => tickets.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    user_id: integer("user_id").notNull().references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [index("TicketComment_ticket_id_idx").on(table.ticket_id)],
);

export const csat = sqliteTable(
  "CSAT",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    rating: integer("rating").notNull(),
    rating_speed: integer("rating_speed"),
    rating_attitude: integer("rating_attitude"),
    rating_impact: integer("rating_impact"),
    comment: text("comment"),
    resolution_time_ms: integer("resolution_time_ms"),
    submitted_at: sqliteDate("submitted_at").notNull().default(sqliteNow),
    ticket_id: integer("ticket_id").notNull().references(() => tickets.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    agent_id: integer("agent_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [uniqueIndex("CSAT_ticket_id_key").on(table.ticket_id)],
);

