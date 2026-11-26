// ============================================================
// Internal Ticketing System — Frontend Types
// Derived from Prisma schema + API response shapes
// ============================================================

// ── Enums ───────────────────────────────────────────────────

export type Role = 'user' | 'mis' | 'approver' | 'admin';

export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'pending_approval'
  | 'pending_hard_copy'
  | 'resolved'
  | 'closed'
  | 'rejected';

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type NotificationType =
  | 'ticket_created'
  | 'ticket_assigned'
  | 'approval_requested'
  | 'approval_decided'
  | 'ticket_resolved'
  | 'ticket_reopened'
  | 'escalated'
  | 'comment_added'
  | 'message_received';

export type AttachmentType = 'approval_form' | 'screenshot' | 'document' | 'other';

// ── Reference Data ──────────────────────────────────────────

export type Department = {
  id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
};

export type AffectedSystem = {
  id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
  department_id?: number | null;
};

export type RequestType = {
  id: number;
  name: string;
  description?: string | null;
  requires_approval_by_default: boolean;
  is_active: boolean;
  department_id?: number | null;
};

export type HardwareItem = {
  id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
};

// ── Users ───────────────────────────────────────────────────

export type User = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  username: string;
  position?: string;
  message_notifications?: boolean;
  is_active?: boolean;
  last_active?: string;
  created_at?: string;
  updated_at?: string;
  department_id?: number;
  department?: Department;
  roles: string[];
};

// ── Tickets ─────────────────────────────────────────────────

export type Ticket = {
  id: number;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  reopen_count: number;
  requires_approval: boolean;
  escalated_to_approval: boolean;
  escalated_at?: string;
  escalated_by_id?: number;
  started_at?: string;
  completed_at?: string;
  due_date?: string;
  sla_breached: boolean;
  breached_at?: string;
  created_at: string;
  updated_at: string;
  requester_id: number;
  requester?: User;
  assignee_id?: number;
  assignee?: User;
  request_type_id?: number;
  request_type?: RequestType;
  affected_system_id?: number;
  affected_system?: AffectedSystem;
  department_id?: number | null;
  department?: Department;
  other_request_type?: string | null;
  other_affected_system?: string | null;
  other_department?: string | null;
  hardware_item_id?: number | null;
  hardware_item?: HardwareItem | null;
  approvers?: TicketApprover[];
  attachments?: Attachment[];
  comments?: TicketComment[];
  resolution_attempts?: ResolutionAttempt[];
  audit_logs?: AuditLog[];
  csat?: CSAT;
};

// ── Approval Workflow ───────────────────────────────────────

export type TicketApprover = {
  id: number;
  status: ApprovalStatus;
  remarks?: string;
  decided_at?: string;
  created_at: string;
  ticket_id: number;
  approver_id: number;
  approver?: User;
};

// ── Attachments ─────────────────────────────────────────────

export type Attachment = {
  id: number;
  file_name: string;
  file_url: string;
  file_size?: number;
  mime_type?: string;
  type: AttachmentType;
  uploaded_at: string;
  ticket_id: number;
};

// ── Comments ────────────────────────────────────────────────

export type TicketComment = {
  id: number;
  content: string;
  is_internal: boolean;
  created_at: string;
  updated_at: string;
  ticket_id: number;
  user_id: number;
  user?: Pick<User, 'id' | 'first_name' | 'last_name' | 'username'>;
};

// ── Resolution Attempts ─────────────────────────────────────

export type ResolutionAttempt = {
  id: number;
  attempt_number: number;
  notes?: string;
  resolved_at?: string;
  reopened_at?: string;
  reopen_reason?: string;
  created_at: string;
  ticket_id: number;
  handled_by_id?: number;
  handled_by?: User;
};

// ── Audit Log ───────────────────────────────────────────────

export type AuditLog = {
  id: number;
  action: string;
  old_value?: string;
  new_value?: string;
  notes?: string;
  created_at: string;
  ticket_id?: number;
  performed_by_id?: number;
  performed_by?: User;
};

// ── Notifications ───────────────────────────────────────────

export type Notification = {
  id: number;
  type: NotificationType;
  message: string;
  is_read: boolean;
  created_at: string;
  read_at?: string;
  ticket_id?: number;
  user_id: number;
};

// ── Messaging ──────────────────────────────────────────────

export type Message = {
  id: number;
  content: string;
  created_at: string;
  is_read: boolean;
  sender_id: number;
  receiver_id: number;
  sender?: Pick<User, 'id' | 'first_name' | 'last_name' | 'username'>;
  receiver?: Pick<User, 'id' | 'first_name' | 'last_name' | 'username'>;
  ticket_id?: number | null;
  ticket?: Pick<Ticket, 'id' | 'title'> & { status: string } | null;
};

// ── CSAT ────────────────────────────────────────────────────

export type CSAT = {
  id: number;
  rating: number;
  rating_speed?: number;
  rating_attitude?: number;
  rating_impact?: number;
  comment?: string;
  resolution_time_ms?: number;
  submitted_at: string;
  ticket_id: number;
  agent_id?: number;
  ticket?: Partial<Ticket>;
  agent?: User;
};

export type CSATStats = {
  average_rating: number;
  total_responses: number;
  distribution: Record<number, number>;
  trend: { date: string; average: number }[];
  agent_leaderboard: { agent_id: number; name: string; average: number; count: number }[];
  dimension_breakdown: {
    departments: Record<string, number>;
    priorities: Record<string, number>;
  };
  sla_impact: { breached: number; met: number };
};

export type RecentCSAT = {
  id: number;
  rating: number;
  comment?: string;
  submitted_at: string;
  ticket_title: string;
  requester_name: string;
  agent_name: string;
};

// ── API Response Wrappers ───────────────────────────────────

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  pages: number;
};

export type PaginatedResponse<T> = {
  data: T[];
  pagination: Pagination;
};

export type LoginResponse = {
  message: string;
  user: User;
};

export type DashboardSummary = {
  tickets: Ticket[];
  unratedTickets: Ticket[];
  activeUsers: User[];
  pendingApprovals: TicketApprover[];
  stats: {
    totalOpen: number;
    totalInProgress: number;
    totalOverdue: number;
    totalResolved: number;
    totalClosed: number;
    totalAll: number;
    totalAssignedToMe: number;
    totalDepartmentUnassigned: number;
    totalUnrated: number;
    totalPendingApprovals: number;
  };
  analytics: {
    trends: { date: string; new: number; resolved: number }[];
    byType: { name: string; count: number }[];
    byPriority: { name: string; count: number }[];
  };
};
