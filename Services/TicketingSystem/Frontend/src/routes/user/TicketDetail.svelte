<script lang="ts">
  import { getTicket } from "../../lib/tickets.remote";
  import { getAssignees, getApprovers } from "../../lib/users.remote";
  import { updateTicket, toggleTicketApprover, escalateTicket as requestEscalation, createComment, updateComment, decideApproval } from "../../lib/ticket-actions.remote";
  import { ticketStatusSchema, ticketPrioritySchema } from "../../lib/validation/ticket-writes";
  import { submitCsat as saveCsat } from "../../lib/csat.remote";
  import { getConversations, sendMessage } from "../../lib/messages.remote";
  import { resolve } from '$app/paths';
  import { onMount, onDestroy, tick } from "svelte";
  import { api, API_BASE } from "../../lib/api";
  import { route, navigate } from "../../router.svelte";
  import { getCurrentUser, hasRole } from "../../stores/user.svelte";
  import {
    simpleConfirm,
    simplePrompt,
    triggerAlert,
  } from "../../stores/ui.svelte";
  import { ws } from "../../lib/ws";
  import {
    getDepartments,
    getAffectedSystems,
    getRequestTypes,
    getHardwareItems,
    fetchReferenceData,
  } from "../../stores/reference.svelte";
  import type { Ticket, TicketComment, User } from "../../lib/types";
  import StatusBadge from "../../components/StatusBadge.svelte";
  import PriorityBadge from "../../components/PriorityBadge.svelte";
  import RichTextEditor from "../../components/RichTextEditor.svelte";
  import {
    Send,
    MessageSquare,
    Paperclip,
    Upload,
    Trash2,
    Download,
    Pencil,
    CircleCheckBig,
    TriangleAlert,
    Star,
    ClipboardCheck,
    ImageIcon,
    Search,
    Plus,
    CircleUser,
    UserCheck,
    LayoutGrid,
    Monitor,
    Building2,
    Calendar,
    Clock,
    CheckCheck,
    CircleX,
    Lock,
    FileText,
    Users,
    Play,
    Pause,
    Undo2,
    FilePenLine,
    CircleArrowUp,
    ShieldCheck,
    X,
    Save,
    Timer,
  } from "lucide-svelte";


  let ticket = $state<Ticket | null>(null);
  let loading = $state(true);
  let activeTab = $state<"comments" | "attachments" | "approvals">("comments");

  // Editing Content
  let isEditingContent = $state(false);
  let editTitle = $state("");
  let editDescription = $state("");
  let editPriority = $state("");
  let editDepartmentId = $state<number | null>(null);
  let editRequestTypeId = $state<number | null>(null);
  let editAffectedSystemId = $state<number | null>(null);
  let editHardwareItemId = $state<number | null>(null);
  let editDueDate = $state("");
  let editOtherRequestType = $state("");
  let editOtherAffectedSystem = $state("");
  let editOtherDepartment = $state("");
  let saveLoading = $state(false);

  // Comment form
  let commentText = $state("");
  let isInternal = $state(false);
  let commentLoading = $state(false);
  let commentContainer = $state<HTMLDivElement | null>(null);

  // Status update
  let assignees = $state<User[]>([]);
  let assigneeSearch = $state("");
  let allApprovers = $state<User[]>([]);
  let resolutionNotes = $state("");
  let reopenReason = $state("");
  let statusLoading = $state(false);
  let statusError = $state("");

  // Filtered assignees based on search
  let filteredAssignees = $derived(
    assignees.filter((a) => {
      const full = `${a.first_name} ${a.last_name} ${a.username}`.toLowerCase();
      return full.includes(assigneeSearch.toLowerCase());
    }),
  );

  // File upload
  let fileInput = $state<HTMLInputElement | undefined>(undefined);
  let uploadLoading = $state(false);

  // CSAT
  let csatRatingSpeed = $state(0);
  let csatRatingAttitude = $state(0);
  let csatRatingImpact = $state(0);
  let csatComment = $state("");
  let csatSubmitted = $state(false);
  let csatLoading = $state(false);

  let systems = $derived(getAffectedSystems());
  let requestTypes = $derived(getRequestTypes());
  let departments = $derived(getDepartments());
  let hardwareItems = $derived(getHardwareItems());

  let user = $derived(getCurrentUser());
  let isOwner = $derived(
    ticket && user ? Number(ticket.requester_id) === Number(user.id) : false,
  );
  let isAssigned = $derived(
    ticket && user ? Number(ticket.assignee_id) === Number(user.id) : false,
  );
  let isPendingApprover = $derived(
    ticket?.approvers?.some(
      (a) =>
        Number(a.approver_id) === Number(user?.id) && a.status === "pending",
    ),
  );
  let canManage = $derived(hasRole("admin", "mis") || isAssigned);
  let canClaim = $derived(
    ticket &&
      !ticket.assignee_id &&
      (hasRole("admin", "mis") ||
        (user?.department_id &&
          (Number(ticket.department_id) === Number(user.department_id) ||
            Number(ticket.affected_system?.department_id) ===
              Number(user.department_id) ||
            Number(ticket.request_type?.department_id) ===
              Number(user.department_id)))),
  );

  // Editable by requester only if in open/rejected/pending state
  let canEditContent = $derived(
    hasRole("admin", "mis") ||
      (isOwner &&
        (ticket?.status === "open" ||
          ticket?.status === "rejected" ||
          ticket?.status === "pending_approval")),
  );

  // Quick actions: visible when assignee is viewing an active ticket
  let canResolve = $derived(
    isAssigned &&
      (ticket?.status === "in_progress" ||
        ticket?.status === "pending_hard_copy"),
  );
  let canClose = $derived(hasRole("admin") && ticket?.status === "resolved");
  let canReject = $derived(
    canManage &&
      ticket?.status !== "closed" &&
      ticket?.status !== "resolved" &&
      ticket?.status !== "rejected",
  );
  let canReopen = $derived(
    (isOwner || hasRole("admin", "mis")) &&
      (ticket?.status === "closed" ||
        ticket?.status === "resolved" ||
        ticket?.status === "rejected"),
  );

  function startEditing() {
    if (!ticket) return;
    editTitle = ticket.title;
    editDescription = ticket.description;
    editPriority = ticket.priority;
    editDepartmentId = ticket.department_id ?? null;
    editRequestTypeId = ticket.request_type_id ?? null;
    editAffectedSystemId = ticket.affected_system_id ?? null;
    editHardwareItemId = ticket.hardware_item_id ?? null;
    editDueDate = formatForDateTimeLocal(ticket.due_date);
    editOtherRequestType = ticket.other_request_type ?? "";
    editOtherAffectedSystem = ticket.other_affected_system ?? "";
    editOtherDepartment = ticket.other_department ?? "";
    isEditingContent = true;
  }

  function cancelEditing() {
    isEditingContent = false;
  }

  async function saveContent() {
    if (!ticket || !editTitle.trim() || !editDescription.trim()) return;
    saveLoading = true;
    try {
      const isHardware = requestTypes.find(t => t.id === editRequestTypeId)?.name === "Hardware Issue";

      const body: any = {
        title: editTitle,
        description: editDescription,
        department_id: editDepartmentId,
        request_type_id: editRequestTypeId,
        affected_system_id: isHardware ? null : editAffectedSystemId,
        hardware_item_id: isHardware ? editHardwareItemId : null,
      };

      if (hasRole("admin", "mis")) {
        body.priority = editPriority;
        body.due_date = editDueDate ? new Date(editDueDate).toISOString() : null;
        body.other_request_type = editOtherRequestType || null;
        body.other_affected_system = editOtherAffectedSystem || null;
        body.other_department = editOtherDepartment || null;
      }

      await updateTicket({ id: ticket.id, data: body });
      triggerAlert("Ticket updated successfully.", "success");
      isEditingContent = false;
      await loadTicket();
    } catch (e: any) {
      statusError = e.message;
    }
    saveLoading = false;
  }

  async function updateDueDate(val: string) {
    if (!ticket) return;
    statusLoading = true;
    try {
      await updateTicket({ id: ticket.id, data: {
        due_date: val ? new Date(val).toISOString() : null,
      } });
      await loadTicket();
      triggerAlert("Due date updated.", "info");
    } catch (e: any) {
      statusError = e.message;
    }
    statusLoading = false;
  }

  async function updatePriority(val: string) {
    if (!ticket) return;
    statusLoading = true;
    try {
      await updateTicket({ id: ticket.id, data: { priority: ticketPrioritySchema.parse(val) } });
      await loadTicket();
      triggerAlert("Priority updated.", "info");
    } catch (e: any) {
      statusError = e.message;
    }
    statusLoading = false;
  }

  async function updateStatus(status: string, notes?: string) {
    if (!ticket) return;
    statusLoading = true;
    statusError = "";
    try {
      await updateTicket({ id: ticket.id, data: {
        status: ticketStatusSchema.parse(status),
        resolution_notes: status === "resolved" ? notes : undefined,
        reopen_reason:
          status === "open" &&
          (ticket.status === "closed" || ticket.status === "resolved")
            ? notes
            : undefined,
      } });
      await loadTicket();
    } catch (e: any) {
      statusError = e?.message ?? "Update failed";
    }
    statusLoading = false;
  }

  async function quickResolve() {
    if (!ticket) return;
    const notes = await simplePrompt(
      "Resolution notes (optional):",
      "Describe how this was resolved...",
    );
    if (notes === null) return;
    await updateStatus("resolved", notes);
  }

  async function quickClose() {
    if (!ticket) return;
    if (
      !(await simpleConfirm(
        "Close this ticket? This cannot be undone easily.",
        true,
      ))
    )
      return;
    await updateStatus("closed");
  }

  async function quickReject() {
    if (!ticket) return;
    if (!(await simpleConfirm("Reject this ticket?", true))) return;
    await updateStatus("rejected");
  }

  async function quickReopen() {
    if (!ticket) return;
    const reason = await simplePrompt(
      "Reopen reason:",
      "Why is this ticket being reopened?",
    );
    if (reason === null) return;
    await updateStatus("open", reason || "Ticket reopened");
  }

  async function toggleApprover(approverId: number) {
    if (!ticket) return;
    statusLoading = true;
    statusError = "";
    try {
      await toggleTicketApprover({ id: ticket.id,
        approver_id: approverId,
      });
      await loadTicket();
    } catch (e: any) {
      statusError = e.message;
    }
    statusLoading = false;
  }

  async function assignTicket(id: number | null) {
    if (!ticket) return;
    statusLoading = true;
    statusError = "";
    try {
      await updateTicket({ id: ticket.id, data: { assignee_id: id } });
      await loadTicket();
    } catch (e: any) {
      statusError = e.message;
    }
    statusLoading = false;
  }

  async function claimTicket() {
    if (!ticket || !user) return;
    await assignTicket(user.id);
    if (ticket.status === "open") {
      await updateStatus("in_progress");
    }
  }

  async function escalateTicket() {
    if (!ticket) return;
    if (
      !(await simpleConfirm(
        "Escalate this ticket? This will move it to Pending Approval and notify approvers.",
        true,
      ))
    )
      return;
    statusLoading = true;
    try {
      await requestEscalation(ticket.id);
      await loadTicket();
      triggerAlert("Ticket successfully escalated to approval.", "success");
    } catch (e: any) {
      statusError = e?.message ?? "Escalation failed";
    }
    statusLoading = false;
  }

  let showCsat = $derived(
    isOwner &&
      (ticket?.status === "resolved" || ticket?.status === "closed") &&
      !ticket?.csat &&
      !csatSubmitted,
  );

  onMount(async () => {
    await Promise.all([loadTicket(), fetchReferenceData()]);
    // Guard: If ticket load failed or user logged out during load, stop.
    if (!ticket || !getCurrentUser()) return;

    try {
      const assigneeQuery = getAssignees({ department_id: ticket.department_id ?? undefined });
      await Promise.all([assigneeQuery.refresh(), getApprovers().refresh(), getConversations().refresh()]);
      const [assigneesRes, approversRes, conversationsRes] = await Promise.all([
        assigneeQuery,
        getApprovers(),
        getConversations(),
      ]);
      if (assigneesRes) assignees = assigneesRes;
      if (approversRes) allApprovers = approversRes;
      if (conversationsRes) recentContacts = conversationsRes;
    } catch {
      /* non-critical */
    }
  });

  $effect(() => {
    if (!ticket?.id) return;

    const unsubUpdate = ws.onTicketUpdate(ticket.id, (update) => {
      if (ticket) {
        if (update.status) {
          (ticket as any).status = update.status;
        }
        if (update.field.includes(",")) {
          loadTicket();
        }
      }
    });

    const unsubComment = ws.onComment(ticket.id, (comment) => {
      if (ticket) {
        // Defensive check: skip if internal note and user is not staff
        if (comment.is_internal && !hasRole("admin", "mis", "approver")) return;

        if (!ticket.comments) ticket.comments = [];
        if (!ticket.comments.some((c) => c.id === comment.id)) {
          ticket.comments = [...ticket.comments, comment as any];
          scrollToBottom();
        }
      }
    });

    return () => {
      unsubUpdate();
      unsubComment();
    };
  });

  async function loadTicket() {
    loading = true;
    try {
      const result = getTicket(Number(route.params.id));
      await result.refresh();
      const res = await result;
      if (res) {
        ticket = res;
        if (res.csat) csatSubmitted = true;
        scrollToBottom();
      }
    } catch (error) {
      ticket = null;
      triggerAlert(error instanceof Error ? error.message : 'Failed to load ticket', 'error');
    } finally {
      loading = false;
    }
  }

  let editingCommentId = $state<number | null>(null);

  async function submitComment() {
    if (!commentText.trim() || !ticket) return;
    commentLoading = true;
    try {
      if (editingCommentId) {
        await updateComment({ id: editingCommentId, data: {
          content: commentText,
          is_internal: isInternal,
        } });
      } else {
        await createComment({
          ticket_id: ticket.id,
          content: commentText,
          is_internal: isInternal,
        });
      }
      commentText = "";
      isInternal = false;
      editingCommentId = null;
      await loadTicket();
      scrollToBottom();
    } catch {
      /* handled */
    }
    commentLoading = false;
  }

  function editComment(comment: TicketComment) {
    editingCommentId = comment.id;
    commentText = comment.content;
    isInternal = comment.is_internal;
  }

  async function handleUpload() {
    if (!fileInput?.files?.length || !ticket) return;
    uploadLoading = true;
    try {
      await api.upload(ticket.id, fileInput!.files!);
      fileInput!.value = "";
      await loadTicket();
    } catch {
      /* handled */
    }
    uploadLoading = false;
  }

  async function deleteAttachment(id: number) {
    if (!(await simpleConfirm("Delete this attachment?", true))) return;
    await api.deleteAttachment(id);
    await loadTicket();
  }

  async function submitCsat() {
    if (!ticket || csatRatingSpeed < 1 || csatRatingAttitude < 1 || csatRatingImpact < 1) return;
    csatLoading = true;
    try {
      await saveCsat({
        ticket_id: ticket.id,
        rating_speed: csatRatingSpeed,
        rating_attitude: csatRatingAttitude,
        rating_impact: csatRatingImpact,
        comment: csatComment || undefined,
      });
      csatSubmitted = true;
      await loadTicket();
    } catch {
      /* handled */
    }
    csatLoading = false;
  }

  async function handleApproval(
    approvalId: number,
    decision: "approved" | "rejected",
  ) {
    const remarks = await simplePrompt(
      `Remarks for ${decision}:`,
      "Add any internal remarks...",
    );
    if (remarks === null) return;
    await decideApproval({ id: approvalId,
      ticket_id: ticket!.id,
      decision,
      remarks: remarks ?? undefined,
    });
    await loadTicket();
  }

  function formatDate(d: string | undefined): string {
    if (!d) return "-";
    return new Date(d).toLocaleString();
  }

  function formatDateShort(d: string | undefined): string {
    if (!d) return "-";
    return new Date(d).toLocaleDateString();
  }

  function formatForDateTimeLocal(d: string | undefined): string {
    if (!d) return "";
    const date = new Date(d);
    if (isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  // Helpers
  async function scrollToBottom() {
    await tick();
    if (commentContainer) {
      commentContainer.scrollTop = commentContainer.scrollHeight;
    }
  }

  function isImage(att: any) {
    if (!att || !att.file_name) return false;
    if (att.mime_type?.startsWith("image/")) return true;
    const ext = att.file_name.split(".").pop()?.toLowerCase();
    return ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext ?? "");
  }

  function formatDuration(ms: number | undefined): string {
    if (ms === undefined || ms < 0) return "-";
    if (ms < 60000) return "< 1m";
    
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  }

  function getWaitTime(t: Ticket | null): number | undefined {
    if (!t || !t.created_at || !t.started_at) return undefined;
    return new Date(t.started_at).getTime() - new Date(t.created_at).getTime();
  }

  function getResolutionTime(t: Ticket | null): number | undefined {
    if (!t || !t.started_at || !t.completed_at) return undefined;
    return new Date(t.completed_at).getTime() - new Date(t.started_at).getTime();
  }

  let imageAttachments = $derived(ticket?.attachments?.filter(isImage) ?? []);
  let selectedZoomImage = $state<string | null>(null);

  // Sharing
  let recentContacts = $state<any[]>([]);
  let sharingToId = $state<number | undefined>(undefined);
  let shareLoading = $state(false);

  let combinedContacts = $derived.by(() => {
    const list = [...recentContacts];
    assignees.forEach((a) => {
      if (!list.some((c) => c.id === a.id) && a.id !== user?.id) {
        list.push({ ...a, last_message: null });
      }
    });
    return list;
  });

  async function shareReference() {
    if (!ticket || !sharingToId) return;
    shareLoading = true;
    try {
      await sendMessage({
        content: `Hi, referencing Ticket #${ticket.id}: "${ticket.title}"`,
        receiver_id: Number(sharingToId),
        ticket_id: ticket.id,
      });
      (navigate as any)(`/messages/${sharingToId}`);
      } catch {
      /* handled */
    }
    shareLoading = false;
  }
</script>

<div class="flex flex-col gap-4 max-w-7xl mx-auto w-full px-4 lg:px-6">
  {#if loading}
    <div class="flex justify-center py-20">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
  {:else if !ticket}
    <div class="text-center py-20 opacity-60">Ticket not found</div>
  {:else}
    <!-- Pending Approval Banner -->
    {#if isPendingApprover}
      {@const myApproval = ticket?.approvers?.find(
        (a) =>
          Number(a.approver_id) === Number(user?.id) && a.status === "pending",
      )}
      <div
        class="alert alert-primary shadow-md border-primary/20 flex flex-col sm:flex-row items-center justify-between gap-3 py-3"
      >
        <div class="flex items-center gap-3">
          <div
            class="bg-primary-content/20 p-1.5 rounded-lg text-primary-content"
          >
            <ClipboardCheck size={20} class="text-warning" />
          </div>
          <div>
            <h3 class="font-bold text-sm">Approval Required</h3>
            <p class="text-xs opacity-90">
              Please review and provide your decision for this request.
            </p>
          </div>
        </div>
        <div class="flex gap-2 w-full sm:w-auto">
          <button
            class="btn btn-sm btn-success flex-1 sm:flex-none gap-1.5"
            onclick={() =>
              myApproval && handleApproval(myApproval.id, "approved")}
          >
            <CircleCheckBig size={14} /> Approve
          </button>
          <button
            class="btn btn-sm btn-error flex-1 sm:flex-none gap-1.5"
            onclick={() =>
              myApproval && handleApproval(myApproval.id, "rejected")}
          >
            <CircleX size={14} /> Reject
          </button>
        </div>
      </div>
    {/if}

    <!-- CSAT Notification Banner -->
    {#if showCsat}
      <div
        class="alert alert-warning shadow-md border-warning/20 flex flex-col sm:flex-row items-center justify-between gap-3 py-3"
      >
        <div class="flex items-center gap-3">
          <div
            class="bg-warning/20 p-1.5 rounded-lg text-warning-content"
          >
            <Star size={20} class="text-warning" fill="currentColor" />
          </div>
          <div>
            <h3 class="font-bold text-sm">How did we do?</h3>
            <p class="text-xs opacity-90">
              Your ticket has been resolved. Please share your feedback to help us improve.
            </p>
          </div>
        </div>
        <div class="flex gap-2 w-full sm:w-auto">
          <button
            class="btn btn-sm btn-warning flex-1 sm:flex-none gap-1.5"
            onclick={() => {
              const el = document.getElementById('csat-section');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <FilePenLine size={14} /> Rate Now
          </button>
        </div>
      </div>
    {/if}

    <div
      class="bg-base-100 px-4 py-3 rounded-xl shadow-sm border border-base-300"
    >
      <div
        class="flex flex-col md:flex-row md:items-center justify-between gap-3"
      >
        <div class="space-y-1 min-w-0">
          {#if ticket.escalated_to_approval}
            <div class="flex items-center gap-1.5 text-warning mb-1">
              <TriangleAlert size={12} class="animate-pulse" />
              <span class="text-[10px] font-bold uppercase tracking-wider"
                >Escalated to Approval</span
              >
            </div>
          {/if}
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="badge badge-outline font-mono text-[10px] h-5"
              >#{ticket.id}</span
            >
            <StatusBadge 
              status={ticket.status} 
              suffix={ticket.completed_at && ticket.started_at && (ticket.status === "resolved" || ticket.status === "closed") 
                ? formatDuration(getResolutionTime(ticket)) 
                : undefined} 
            />
            <PriorityBadge priority={ticket.priority} />
            {#if ticket.reopen_count > 0}
              <span class="badge badge-warning badge-sm gap-1">
                <Undo2 size={10} /> REOPENED
              </span>
            {/if}
            {#if ticket.sla_breached}
              <span class="badge badge-error badge-sm gap-1 animate-pulse">
                <TriangleAlert size={10} /> OVERDUE
              </span>
            {/if}
            {#if canEditContent && !isEditingContent}
              <button
                class="btn btn-ghost btn-xs gap-1 opacity-50 hover:opacity-100 h-5 min-h-0"
                onclick={startEditing}
              >
                <Pencil size={10} /> Edit
              </button>
            {/if}
          </div>
          {#if isEditingContent}
            <div class="flex flex-col gap-2 mb-2">
              <input
                type="text"
                class="input input-bordered input-sm w-full max-w-2xl font-bold text-lg h-9"
                bind:value={editTitle}
                placeholder="Ticket Title"
              />
              <div class="flex flex-wrap gap-2">
                {#if hasRole("admin", "mis")}
                  <select
                    class="select select-bordered select-xs h-7 min-h-0 text-[10px] font-bold uppercase"
                    bind:value={editPriority}
                  >
                    <option value="low">Low Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="high">High Priority</option>
                    <option value="critical">Critical Priority</option>
                  </select>

                  <input
                    type="datetime-local"
                    class="input input-bordered input-xs h-7 min-h-0 text-[10px] font-bold"
                    bind:value={editDueDate}
                  />
                {/if}

                <select
                  class="select select-bordered select-xs h-7 min-h-0 text-[10px] max-w-[150px]"
                  bind:value={editDepartmentId}
                >
                  <option value={null}>No Department</option>
                  {#each departments as dept}
                    <option value={dept.id}>{dept.name}</option>
                  {/each}
                </select>

                <select
                  class="select select-bordered select-xs h-7 min-h-0 text-[10px] max-w-[150px]"
                  bind:value={editRequestTypeId}
                >
                  <option value={null}>No Request Type</option>
                  {#each requestTypes as type}
                    <option value={type.id}>{type.name}</option>
                  {/each}
                </select>

                <select
                  class="select select-bordered select-xs h-7 min-h-0 text-[10px] max-w-[150px]"
                  bind:value={editAffectedSystemId}
                >
                  <option value={null}>No Affected System</option>
                  {#each systems as sys}
                    <option value={sys.id}>{sys.name}</option>
                  {/each}
                </select>

                {#if editRequestTypeId === requestTypes.find(t => t.name === "Hardware Issue")?.id}
                  <select
                    class="select select-bordered select-xs h-7 min-h-0 text-[10px] max-w-[150px]"
                    bind:value={editHardwareItemId}
                  >
                    <option value={null}>No Hardware Item</option>
                    {#each hardwareItems as item}
                      <option value={item.id}>{item.name}</option>
                    {/each}
                  </select>
                {/if}

                {#if hasRole("admin", "mis")}
                  {#if requestTypes.find((t) => t.id === editRequestTypeId)?.name === "Others"}
                    <input
                      type="text"
                      class="input input-bordered input-xs h-7 min-h-0 text-[10px] w-full max-w-[150px]"
                      placeholder="Specify Request Type..."
                      bind:value={editOtherRequestType}
                    />
                  {/if}
                  {#if systems.find((s) => s.id === editAffectedSystemId)?.name === "Others"}
                    <input
                      type="text"
                      class="input input-bordered input-xs h-7 min-h-0 text-[10px] w-full max-w-[150px]"
                      placeholder="Specify System..."
                      bind:value={editOtherAffectedSystem}
                    />
                  {/if}
                  {#if departments.find((d) => d.id === editDepartmentId)?.name === "Others"}
                    <input
                      type="text"
                      class="input input-bordered input-xs h-7 min-h-0 text-[10px] w-full max-w-[150px]"
                      placeholder="Specify Department..."
                      bind:value={editOtherDepartment}
                    />
                  {/if}
                {/if}
              </div>
            </div>
          {:else}
            <h1 class="text-lg font-bold tracking-tight leading-snug">
              {ticket.title}
            </h1>
          {/if}
          <div
            class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] opacity-50"
          >
            <div class="flex items-center gap-1">
              <CircleUser size={11} />
              <span
                >{ticket.requester
                  ? `${ticket.requester.first_name} ${ticket.requester.last_name}`
                  : "Unknown"}</span
              >
            </div>
            <span>•</span>
            <div class="flex items-center gap-1">
              <Clock size={11} />
              <time>{formatDate(ticket.created_at)}</time>
            </div>
            {#if ticket.due_date}
              <span>•</span>
              <div class="flex items-center gap-1">
                <Calendar size={11} />
                <span>Due {formatDateShort(ticket.due_date)}</span>
              </div>
            {/if}
            {#if ticket.completed_at && (ticket.status === "resolved" || ticket.status === "closed")}
              <span>•</span>
              <div class="flex items-center gap-1 text-success">
                <CheckCheck size={11} />
                <span>Resolved {formatDate(ticket.completed_at)}</span>
              </div>
            {/if}
            {#if ticket.started_at}
              <span>•</span>
              <div class="flex items-center gap-1">
                <Timer size={11} />
                <span>Waited {formatDuration(getWaitTime(ticket))}</span>
              </div>
            {/if}
          </div>
        </div>

        <!-- Quick action buttons for assignee -->
        {#if canResolve || canClose || canReject}
          <div class="flex items-center gap-2 shrink-0">
            {#if canResolve}
              <button
                class="btn btn-success btn-sm gap-1.5 shadow-sm"
                onclick={quickResolve}
                disabled={statusLoading}
              >
                <CheckCheck size={14} /> Resolve
              </button>
            {/if}
            {#if canClose}
              <button
                class="btn btn-neutral btn-sm gap-1.5 shadow-sm"
                onclick={quickClose}
                disabled={statusLoading}
              >
                <Lock size={14} /> Close
              </button>
            {/if}
            {#if canReject}
              <button
                class="btn btn-ghost btn-sm gap-1.5 text-error border border-error/30"
                onclick={quickReject}
                disabled={statusLoading}
              >
                <CircleX size={14} /> Reject
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    {#if statusError}
      <div class="alert alert-error py-2 text-sm">
        <TriangleAlert size={14} />
        {statusError}
      </div>
    {/if}

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <!-- Main content (8/12) -->
      <div class="lg:col-span-8 flex flex-col gap-4">
        <!-- Description -->
        <div class="card bg-base-100 shadow-sm border border-base-300">
          <div class="card-body p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <FileText size={13} class="text-primary/70" />
                <h3
                  class="font-bold text-[10px] uppercase tracking-wider text-primary/70"
                >
                  Issue Details
                </h3>
              </div>

              {#if isEditingContent}
                <div class="flex items-center gap-2">
                  <button
                    class="btn btn-ghost btn-xs gap-1.5 h-7 min-h-0 px-2"
                    onclick={cancelEditing}
                    disabled={saveLoading}
                  >
                    <X size={12} /> Cancel
                  </button>
                  <button
                    class="btn btn-primary btn-xs gap-1.5 h-7 min-h-0 px-3 shadow-sm"
                    onclick={saveContent}
                    disabled={saveLoading ||
                      !editTitle.trim() ||
                      !editDescription.trim()}
                  >
                    {#if saveLoading}<span
                        class="loading loading-spinner loading-xs"
                      ></span>{:else}<Save size={12} />{/if}
                    Save Changes
                  </button>
                </div>
              {/if}
            </div>

            {#if isEditingContent}
              <div class="mt-1">
                <RichTextEditor bind:value={editDescription} />
              </div>
            {:else}
              <div
                class="prose prose-sm prose-invert max-w-none overflow-x-auto w-full"
              >
                {#if ticket.description}
                  {@html ticket.description}
                {:else}
                  <p class="italic opacity-30 text-sm">
                    No description provided.
                  </p>
                {/if}
              </div>
            {/if}

            <!-- Inline Image Gallery -->
            {#if imageAttachments.length > 0}
              <div class="pt-3 mt-3 border-t border-base-200">
                <div class="flex items-center gap-2 mb-2">
                  <ImageIcon size={12} class="opacity-40" />
                  <span
                    class="text-[10px] font-bold uppercase tracking-widest opacity-40"
                  >
                    Images ({imageAttachments.length})
                  </span>
                </div>
                <div
                  class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2"
                >
                  {#each imageAttachments as att (att.id)}
                    <button
                      type="button"
                      class="aspect-square bg-base-200 rounded-lg overflow-hidden border border-base-300 hover:border-primary/50 transition-all group relative p-0"
                      onclick={() =>
                        (selectedZoomImage = att.file_url)}
                    >
                      <img
                        src={`${API_BASE}${att.file_url}?preview=1`}
                        loading="lazy"
                        decoding="async"
                        alt={att.file_name}
                        class="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                      <div
                        class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      >
                        <Search size={18} class="text-white" />
                      </div>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>

        <!-- CSAT section -->
        {#if showCsat}
          <div
            id="csat-section"
            class="card bg-warning/5 border border-warning/20 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300"
          >
            <div class="card-body p-4">
              <div class="flex items-center gap-2 mb-3">
                <Star size={16} class="text-warning" fill="currentColor" />
                <h3 class="font-bold text-sm">Rate your experience</h3>
              </div>

              <div class="flex flex-col gap-4">
                <div class="space-y-3">
                  <!-- Speed -->
                  <div class="flex items-center justify-between gap-3 bg-base-100 p-2 rounded-lg border border-base-200">
                    <span class="text-xs font-bold opacity-60">How fast were we?</span>
                    <div class="flex gap-1">
                      {#each [1, 2, 3, 4, 5] as star}
                        <button
                          class="btn btn-ghost btn-xs btn-square p-0 hover:bg-warning/20 transition-colors"
                          onclick={() => (csatRatingSpeed = star)}
                        >
                          <Star
                            size={18}
                            fill={star <= csatRatingSpeed ? "currentColor" : "none"}
                            class={star <= csatRatingSpeed ? "text-warning" : "opacity-20"}
                          />
                        </button>
                      {/each}
                    </div>
                  </div>

                  <!-- Attitude -->
                  <div class="flex items-center justify-between gap-3 bg-base-100 p-2 rounded-lg border border-base-200">
                    <span class="text-xs font-bold opacity-60">How was the attitude of the resolver?</span>
                    <div class="flex gap-1">
                      {#each [1, 2, 3, 4, 5] as star}
                        <button
                          class="btn btn-ghost btn-xs btn-square p-0 hover:bg-warning/20 transition-colors"
                          onclick={() => (csatRatingAttitude = star)}
                        >
                          <Star
                            size={18}
                            fill={star <= csatRatingAttitude ? "currentColor" : "none"}
                            class={star <= csatRatingAttitude ? "text-warning" : "opacity-20"}
                          />
                        </button>
                      {/each}
                    </div>
                  </div>

                  <!-- Impact -->
                  <div class="flex items-center justify-between gap-3 bg-base-100 p-2 rounded-lg border border-base-200">
                    <span class="text-xs font-bold opacity-60">Did it help your work?</span>
                    <div class="flex gap-1">
                      {#each [1, 2, 3, 4, 5] as star}
                        <button
                          class="btn btn-ghost btn-xs btn-square p-0 hover:bg-warning/20 transition-colors"
                          onclick={() => (csatRatingImpact = star)}
                        >
                          <Star
                            size={18}
                            fill={star <= csatRatingImpact ? "currentColor" : "none"}
                            class={star <= csatRatingImpact ? "text-warning" : "opacity-20"}
                          />
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <textarea
                    class="textarea textarea-bordered textarea-sm w-full bg-base-100 min-h-[80px] text-sm leading-relaxed"
                    placeholder="Anything else we should know? (optional)..."
                    bind:value={csatComment}
                  ></textarea>

                  <div class="flex justify-end">
                    <button
                      class="btn btn-warning btn-sm px-6 gap-2 shadow-sm"
                      onclick={submitCsat}
                      disabled={csatRatingSpeed < 1 || csatRatingAttitude < 1 || csatRatingImpact < 1 || csatLoading}
                    >
                      {#if csatLoading}
                        <span class="loading loading-spinner loading-xs"></span>
                      {:else}
                        <Send size={14} />
                      {/if}
                      Submit Feedback
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        {/if}

        {#if ticket?.csat}
          <div class="card bg-base-100 shadow-sm border border-base-300">
            <div class="card-body p-4">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <Star size={14} class="text-warning" fill="currentColor" />
                  <h3
                    class="font-bold text-[10px] uppercase tracking-wider text-base-content/50"
                  >
                    Service Feedback
                  </h3>
                </div>
                <span class="text-[10px] opacity-40"
                  >{formatDate(ticket.csat.submitted_at)}</span
                >
              </div>

              <div class="flex flex-col gap-3">
                <div class="flex gap-0.5">
                  {#each [1, 2, 3, 4, 5] as star}
                    <Star
                      size={18}
                      fill={star <= ticket.csat.rating
                        ? "currentColor"
                        : "none"}
                      class={star <= ticket.csat.rating
                        ? "text-warning"
                        : "opacity-10"}
                    />
                  {/each}
                </div>

                {#if ticket.csat.comment}
                  <div class="relative">
                    <div
                      class="absolute -left-2 top-0 bottom-0 w-1 bg-warning/20 rounded-full"
                    ></div>
                    <p class="text-sm italic opacity-80 pl-3 leading-relaxed">
                      "{ticket.csat.comment}"
                    </p>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/if}

        <!-- Tabs -->
        <div
          class="card bg-base-100 shadow-sm border border-base-300 overflow-hidden"
        >
          <div class="tabs tabs-sm tabs-lifted bg-base-200/30">
            <button
              class="tab gap-1.5"
              class:tab-active={activeTab === "comments"}
              onclick={() => (activeTab = "comments")}
            >
              <MessageSquare size={12} /> Comments
              <span class="badge badge-xs badge-neutral ml-1"
                >{ticket.comments?.length ?? 0}</span
              >
            </button>
            <button
              class="tab gap-1.5"
              class:tab-active={activeTab === "attachments"}
              onclick={() => (activeTab = "attachments")}
            >
              <Paperclip size={12} /> Files
              <span class="badge badge-xs badge-neutral ml-1"
                >{ticket.attachments?.length ?? 0}</span
              >
            </button>
            <button
              class="tab gap-1.5"
              class:tab-active={activeTab === "approvals"}
              onclick={() => (activeTab = "approvals")}
            >
              <Users size={12} /> Approvals
              <span class="badge badge-xs badge-neutral ml-1"
                >{ticket.approvers?.length ?? 0}</span
              >
            </button>
          </div>

          <div class="card-body p-4">
            {#if activeTab === "comments"}
              <div
                class="flex flex-col gap-3 mb-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar"
                bind:this={commentContainer}
              >
                {#each ticket.comments ?? [] as comment (comment.id)}
                  <div
                    class="chat {Number(comment.user_id) === Number(user?.id)
                      ? 'chat-end'
                      : 'chat-start'}"
                  >
                    <div
                      class="chat-image avatar avatar-placeholder relative group"
                    >
                      <div
                        class="bg-neutral text-neutral-content w-7 h-7 rounded-full flex items-center justify-center shadow-sm"
                      >
                        <span class="text-[9px]">
                          {comment.user
                            ? `${comment.user.first_name[0]}${comment.user.last_name[0]}`
                            : "?"}
                        </span>
                      </div>
                      {#if comment.user_id === user?.id || hasRole("admin", "mis")}
                        <div
                          class="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <button
                            class="btn btn-circle btn-xs btn-primary shadow-md scale-75"
                            onclick={() => editComment(comment)}
                            title="Edit"
                          >
                            <Pencil size={8} />
                          </button>
                        </div>
                      {/if}
                    </div>
                    <div
                      class="chat-header mb-0.5 text-[10px] font-medium flex items-center gap-1.5"
                    >
                      <span class="opacity-80">
                        {comment.user
                          ? `${comment.user.first_name} ${comment.user.last_name}`
                          : "Unknown"}
                      </span>
                      <time class="opacity-40 font-normal"
                        >{formatDate(comment.created_at)}</time
                      >
                      {#if comment.is_internal}
                        <span
                          class="text-[9px] text-warning font-bold uppercase tracking-tighter"
                        >
                          INTERNAL</span
                        >
                      {/if}
                    </div>
                    <div
                      class="chat-bubble min-h-0 py-1.5 px-3 shadow-sm text-sm leading-snug prose prose-sm max-w-none
                        {comment.is_internal
                        ? 'chat-bubble-warning'
                        : Number(comment.user_id) === Number(user?.id)
                          ? 'chat-bubble-primary'
                          : 'chat-bubble-neutral'} whitespace-pre-wrap"
                    >
                      {@html comment.content}
                    </div>
                  </div>
                {:else}
                  <div class="text-center py-8 opacity-30 text-xs">
                    <MessageSquare size={20} class="mx-auto mb-2 opacity-50" />
                    <p>No comments yet.</p>
                  </div>
                {/each}
              </div>

              <!-- Comment input -->
              <div
                class="bg-base-200/30 p-3 rounded-lg border border-base-300 flex flex-col gap-2"
              >
                <textarea
                  class="textarea textarea-bordered textarea-sm w-full text-sm bg-base-100"
                  placeholder="Reply..."
                  rows="2"
                  bind:value={commentText}
                  disabled={commentLoading}
                ></textarea>
                <div class="flex items-center justify-between">
                  {#if hasRole("admin", "mis", "approver")}
                    <label class="label cursor-pointer gap-1.5 p-0">
                      <input
                        type="checkbox"
                        class="checkbox checkbox-xs checkbox-warning"
                        bind:checked={isInternal}
                      />
                      <span class="text-[10px] font-bold uppercase opacity-60"
                        >Internal note</span
                      >
                    </label>
                  {:else}
                    <div></div>
                  {/if}
                  <button
                    class="btn btn-primary btn-sm px-4 gap-1.5 text-xs"
                    onclick={submitComment}
                    disabled={!commentText.trim() || commentLoading}
                  >
                    {#if commentLoading}<span
                        class="loading loading-spinner loading-xs"
                      ></span>{/if}
                    <Send size={12} /> Send
                  </button>
                </div>
              </div>
            {:else if activeTab === "attachments"}
              <div class="flex flex-col gap-2">
                {#each ticket.attachments ?? [] as att (att.id)}
                  <div
                    class="flex items-center gap-3 bg-base-100 rounded-lg p-2 border border-base-200 hover:border-base-300 transition-colors"
                  >
                    {#if isImage(att)}
                      <ImageIcon
                        size={13}
                        class="opacity-40 shrink-0 text-primary"
                      />
                    {:else}
                      <Paperclip size={13} class="opacity-40 shrink-0" />
                    {/if}
                    <div class="flex-1 min-w-0">
                      <p class="text-xs font-medium truncate">
                        {att.file_name}
                      </p>
                      <p class="text-[10px] opacity-40">
                        {att.type}
                        {(att.file_size ?? 0) > 0
                          ? `${(att.file_size! / 1024).toFixed(0)} KB`
                          : "unknown size"}
                      </p>
                    </div>
                    {#if isImage(att)}
                      <button
                        class="btn btn-ghost btn-xs h-7 w-7"
                        onclick={() =>
                          (selectedZoomImage = att.file_url)}
                        title="View"
                      >
                        <Search size={12} />
                      </button>
                    {/if}
                    <a
                      href="{API_BASE}{att.file_url}"
                      target="_blank"
                      class="btn btn-ghost btn-xs h-7 w-7"
                      title="Download"
                    >
                      <Download size={12} />
                    </a>
                    {#if hasRole("admin", "mis")}
                      <button
                        class="btn btn-ghost btn-xs h-7 w-7 text-error"
                        onclick={() => deleteAttachment(att.id)}
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    {/if}
                  </div>
                {:else}
                  <div
                    class="text-center py-8 opacity-30 text-xs bg-base-200/50 rounded-lg border border-dashed border-base-300"
                  >
                    <Paperclip size={22} class="mx-auto mb-2 opacity-50" />
                    <p>No files attached to this ticket.</p>
                  </div>
                {/each}

                <div
                  class="bg-base-200/30 p-3 rounded-lg border border-base-300 flex items-center gap-2 mt-1"
                >
                  <input
                    type="file"
                    multiple
                    title="Up to 5 files, 20 MB each"
                    class="file-input file-input-bordered file-input-sm flex-1 text-xs h-8"
                    bind:this={fileInput}
                  />
                  <button
                    class="btn btn-primary btn-sm h-8 px-4 text-xs gap-1.5"
                    onclick={handleUpload}
                    disabled={uploadLoading}
                  >
                    {#if uploadLoading}<span
                        class="loading loading-spinner loading-xs"
                      ></span>{/if}
                    <Upload size={12} /> Upload
                  </button>
                </div>
              </div>
            {:else if activeTab === "approvals"}
              <div class="flex flex-col gap-4">
                {#if hasRole("admin", "mis")}
                  {#if ticket.requires_approval || ticket.escalated_to_approval}
                    <div class="space-y-2">
                      <h4
                        class="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-1.5"
                      >
                        <ShieldCheck size={11} /> Manage Required Approvers
                      </h4>
                      <div class="flex flex-wrap gap-2">
                        {#each allApprovers as approver (approver.id)}
                          {@const isSelected = ticket.approvers?.some(
                            (a) =>
                              Number(a.approver_id) === Number(approver.id),
                          )}
                          {@const hasDecided = ticket.approvers?.some(
                            (a) =>
                              Number(a.approver_id) === Number(approver.id) &&
                              a.status !== "pending",
                          )}
                          <button
                            class="btn btn-sm gap-2 transition-all {isSelected
                              ? 'btn-primary'
                              : 'btn-ghost border-base-300'}"
                            onclick={() => toggleApprover(approver.id)}
                            disabled={statusLoading ||
                              hasDecided ||
                              ["resolved", "closed", "rejected"].includes(
                                ticket.status,
                              )}
                            title={hasDecided
                              ? "Cannot remove after decision"
                              : ["resolved", "closed", "rejected"].includes(
                                    ticket.status,
                                  )
                                ? "Cannot manage approvers on completed ticket"
                                : isSelected
                                  ? "Click to remove"
                                  : "Click to add"}
                          >
                            <div class="avatar avatar-placeholder">
                              <div
                                class="bg-neutral text-neutral-content w-5 h-5 rounded-full"
                              >
                                <span class="text-[8px]"
                                  >{approver.first_name[0]}{approver
                                    .last_name[0]}</span
                                >
                              </div>
                            </div>
                            <span class="text-xs"
                              >{approver.first_name} {approver.last_name}</span
                            >
                            {#if isSelected}
                              <CheckCheck size={12} />
                            {/if}
                          </button>
                        {/each}
                      </div>
                    </div>
                    <div class="divider my-0 opacity-10"></div>
                  {:else}
                    <div
                      class="bg-base-200/50 rounded-xl p-8 text-center border border-dashed border-base-300"
                    >
                      <ShieldCheck
                        size={32}
                        class="mx-auto mb-3 opacity-20 text-primary"
                      />
                      <h3 class="text-sm font-bold opacity-60">
                        No Approval Required
                      </h3>
                      <p class="text-xs opacity-40 mb-4 max-w-xs mx-auto">
                        This is currently a standard ticket. If you need
                        authorization for this request, you can escalate it.
                      </p>
                      <button
                        class="btn btn-primary btn-sm gap-2 shadow-md"
                        onclick={escalateTicket}
                        disabled={statusLoading}
                      >
                        <CircleArrowUp size={14} /> Escalate for Approval
                      </button>
                    </div>
                  {/if}
                {/if}

                {#if (ticket.approvers ?? []).length > 0}
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {#each ticket.approvers as approval (approval.id)}
                      <div
                        class="flex items-center gap-3 bg-base-100 rounded-lg p-2.5 border border-base-200"
                      >
                        <div class="avatar avatar-placeholder shrink-0">
                          <div
                            class="bg-neutral text-neutral-content w-7 h-7 rounded-full"
                          >
                            <span class="text-[9px]">
                              {approval.approver
                                ? `${approval.approver.first_name[0]}${approval.approver.last_name[0]}`
                                : "?"}
                            </span>
                          </div>
                        </div>
                        <div class="flex-1 min-w-0">
                          <p class="text-xs font-bold truncate">
                            {approval.approver
                              ? `${approval.approver.first_name} ${approval.approver.last_name}`
                              : `ID: ${approval.approver_id}`}
                          </p>
                          <span
                            class="text-[9px] uppercase font-bold {approval.status ===
                            'approved'
                              ? 'text-success'
                              : approval.status === 'rejected'
                                ? 'text-error'
                                : 'text-warning'}"
                          >
                            {approval.status}
                          </span>
                        </div>
                        {#if approval.status === "pending" && (approval.approver_id === user?.id || hasRole("admin", "mis"))}
                          <div class="flex gap-1">
                            {#if approval.approver_id === user?.id}
                              <button
                                class="btn btn-success btn-xs btn-square"
                                onclick={() =>
                                  handleApproval(approval.id, "approved")}
                              >
                                <CircleCheckBig size={12} />
                              </button>
                              <button
                                class="btn btn-error btn-xs btn-square"
                                onclick={() =>
                                  handleApproval(approval.id, "rejected")}
                              >
                                <CircleX size={12} />
                              </button>
                            {/if}
                            {#if hasRole("admin", "mis")}
                              <button
                                class="btn btn-ghost btn-xs btn-square text-error"
                                onclick={() =>
                                  toggleApprover(approval.approver_id)}
                                disabled={statusLoading ||
                                  ["resolved", "closed", "rejected"].includes(
                                    ticket.status,
                                  )}
                                title="Remove Approver"
                              >
                                <Trash2 size={12} />
                              </button>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Sidebar (4/12) -->
      <div class="lg:col-span-4 flex flex-col gap-4">
        <!-- Details Card -->
        <div class="card bg-base-100 shadow-sm border border-base-300">
          <div class="card-body p-4 gap-3">
            <h3
              class="font-bold text-[10px] uppercase tracking-widest text-base-content/40 flex items-center gap-1.5"
            >
              <FileText size={11} class="opacity-60" /> Details
            </h3>

            <div class="space-y-2.5">
              <!-- Requester -->
              <div class="flex flex-col gap-0.5 group/req">
                <span
                  class="text-[9px] font-bold uppercase opacity-30 flex items-center gap-1"
                >
                  <CircleUser size={9} /> Requester
                </span>
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium truncate">
                    {ticket?.requester?.first_name}
                    {ticket?.requester?.last_name}
                  </span>
                  {#if ticket && ticket.requester_id !== user?.id}
                      <a
                      href="{resolve('/')}messages/{ticket.requester_id}"
                      class="btn btn-ghost btn-xs h-6 w-6 p-0 opacity-0 group-hover/req:opacity-100 transition-opacity text-primary flex items-center justify-center"
                      title="Chat with Requester"
                    >
                      <MessageSquare size={11} />
                    </a>
                  {/if}
                </div>
              </div>

              <!-- Assignee -->
              <div class="flex flex-col gap-0.5 group/ass">
                <span
                  class="text-[9px] font-bold uppercase opacity-30 flex items-center gap-1"
                >
                  <UserCheck size={9} /> Assignee
                </span>
                <div class="flex items-center justify-between">
                  <span
                    class="text-xs font-medium truncate {ticket?.assignee
                      ? ''
                      : 'italic opacity-40'}"
                  >
                    {ticket?.assignee
                      ? `${ticket.assignee.first_name} ${ticket.assignee.last_name}`
                      : "Unassigned"}
                  </span>
                  {#if ticket && ticket.assignee && ticket.assignee_id !== user?.id}
                    <a
                      href="{resolve('/')}messages/{ticket.assignee_id}"
                      class="btn btn-ghost btn-xs h-6 w-6 p-0 opacity-0 group-hover/ass:opacity-100 transition-opacity text-primary flex items-center justify-center"
                      title="Chat with Assignee"
                    >
                      <MessageSquare size={11} />
                    </a>
                  {/if}
                </div>
              </div>

              <!-- Meta rows -->
              <div
                class="grid grid-cols-1 gap-1.5 pt-2 border-t border-base-200"
              >
                <div class="flex items-center justify-between text-[11px]">
                  <span class="opacity-40 flex items-center gap-1"
                    ><LayoutGrid size={10} /> Type</span
                  >
                  <span class="font-medium">
                    {ticket.request_type?.name ?? "-"}
                    {#if ticket.other_request_type}
                      <span class="opacity-60 italic text-[10px]"
                        >({ticket.other_request_type})</span
                      >
                    {/if}
                  </span>
                </div>
                {#if ticket.request_type_id === requestTypes.find(t => t.name === "Hardware Issue")?.id}
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="opacity-40 flex items-center gap-1"
                      ><Monitor size={10} /> Hardware</span>
                    <span class="font-medium truncate max-w-[120px]">
                      {ticket.hardware_item?.name ?? "-"}
                    </span>
                  </div>
                {:else}
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="opacity-40 flex items-center gap-1"
                      ><Monitor size={10} /> System</span
                    >
                    <span class="font-medium truncate max-w-[120px]">
                      {ticket.affected_system?.name ?? "-"}
                      {#if ticket.other_affected_system}
                        <span class="opacity-60 italic text-[10px]"
                          >({ticket.other_affected_system})</span
                        >
                      {/if}
                    </span>
                  </div>
                {/if}
                <div class="flex items-center justify-between text-[11px]">
                  <span class="opacity-40 flex items-center gap-1"
                    ><Building2 size={10} /> Department</span
                  >
                  <span class="font-medium truncate max-w-[120px]">
                    {ticket.department?.name ?? "-"}
                    {#if ticket.other_department}
                      <span class="opacity-60 italic text-[10px]"
                        >({ticket.other_department})</span
                      >
                    {/if}
                  </span>
                </div>
                {#if ticket.due_date}
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="opacity-40 flex items-center gap-1"
                      ><Calendar size={10} /> Due</span
                    >
                    <span
                      class="font-medium {ticket.sla_breached
                        ? 'text-error'
                        : ''}">{formatDateShort(ticket.due_date)}</span>
                  </div>
                {/if}

                {#if ticket.started_at}
                  <div class="pt-2 mt-1 border-t border-base-200 space-y-1.5">
                    <span class="text-[9px] font-bold uppercase opacity-30 flex items-center gap-1">
                      <Timer size={9} /> Lifecycle Metrics
                    </span>
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="opacity-40">Queue Time</span>
                      <span class="font-medium">{formatDuration(getWaitTime(ticket))}</span>
                    </div>
                    {#if ticket.completed_at}
                      <div class="flex items-center justify-between text-[11px]">
                        <span class="opacity-40">Work Time</span>
                        <span class="font-medium text-success">{formatDuration(getResolutionTime(ticket))}</span>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>

        <!-- Share Card -->
        <div class="card bg-base-100 shadow-sm border border-base-300">
          <div class="card-body p-4 gap-3">
            <h3
              class="font-bold text-[10px] uppercase tracking-widest text-base-content/40 flex items-center gap-1.5"
            >
              <MessageSquare size={11} class="opacity-60" /> Share Reference
            </h3>
            <div class="space-y-2">
              <select
                class="select select-bordered select-sm w-full text-xs h-8 min-h-0"
                bind:value={sharingToId}
              >
                <option value={undefined}>Select contact...</option>
                {#each combinedContacts as contact}
                  <option value={contact.id}
                    >{contact.first_name} {contact.last_name}</option
                  >
                {/each}
              </select>
              <button
                class="btn btn-ghost btn-sm w-full text-xs h-8 min-h-0 gap-2 border border-base-300"
                onclick={shareReference}
                disabled={!sharingToId || shareLoading}
              >
                {#if shareLoading}
                  <span class="loading loading-spinner loading-xs"></span>
                {:else}
                  <MessageSquare size={13} />
                {/if}
                Send to Chat
              </button>
            </div>
          </div>
        </div>

        <!-- Management Card -->
        {#if canManage || canClaim || canReopen}
          <div class="card bg-base-100 shadow-md border border-primary/10">
            <div class="card-body p-4 gap-3">
              <h3
                class="font-bold text-[10px] uppercase tracking-widest text-primary flex items-center gap-1.5"
              >
                <ClipboardCheck size={11} /> Management
              </h3>

              <div class="space-y-3">
                {#if canClaim}
                  <button
                    class="btn btn-primary btn-sm w-full gap-2 shadow-sm"
                    onclick={claimTicket}
                    disabled={statusLoading}
                  >
                    <Plus size={14} /> Assign to Myself
                  </button>
                  <div class="divider my-0 opacity-20"></div>
                {/if}

                {#if !hasRole("admin", "mis") && canReopen}
                  <div class="flex flex-col gap-1.5">
                    <span
                      class="text-[10px] font-bold uppercase tracking-wider text-base-content/40 mb-1"
                    >
                      Workflow Actions
                    </span>
                    <button
                      class="btn btn-ghost btn-sm justify-start gap-2 border border-base-300"
                      onclick={quickReopen}
                      disabled={statusLoading}
                    >
                      <CircleArrowUp size={14} /> Reopen Ticket
                    </button>
                  </div>
                  <div class="divider my-1 opacity-20"></div>
                {/if}

                {#if hasRole("admin", "mis")}
                  <div class="space-y-3">
                    <div class="grid grid-cols-2 gap-2">
                      <div class="flex flex-col gap-1">
                        <span class="text-[9px] font-bold uppercase opacity-40">Priority</span>
                        <select
                          class="select select-bordered select-xs w-full h-8"
                          value={ticket.priority}
                          onchange={(e) => updatePriority(e.currentTarget.value)}
                          disabled={statusLoading}
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </div>
                      <div class="flex flex-col gap-1">
                        <span class="text-[9px] font-bold uppercase opacity-40">Due Date</span>
                        <input
                          type="datetime-local"
                          class="input input-bordered input-xs w-full h-8"
                          value={formatForDateTimeLocal(ticket.due_date)}
                          onchange={(e) => updateDueDate(e.currentTarget.value)}
                          disabled={statusLoading}
                        />
                      </div>
                    </div>

                    <div class="divider my-0 opacity-10"></div>

                    <div class="flex flex-col gap-1.5">
                      <span
                        class="text-[10px] font-bold uppercase tracking-wider text-base-content/40 mb-1"
                      >
                        Workflow Actions
                      </span>

                      <div class="grid grid-cols-1 gap-2">
                        {#if ticket.status === "open"}
                          <button
                            class="btn btn-primary btn-sm justify-start gap-2 shadow-sm"
                            onclick={() => updateStatus("in_progress")}
                            disabled={statusLoading || !ticket.assignee_id}
                            title={!ticket.assignee_id
                              ? "Assignee required to start progress"
                              : ""}
                          >
                            <Play size={14} /> Start Progress
                          </button>
                          {#if !ticket.requires_approval && !ticket.escalated_to_approval}
                            <button
                              class="btn btn-accent btn-sm justify-start gap-2 shadow-sm"
                              onclick={escalateTicket}
                              disabled={statusLoading}
                            >
                              <CircleArrowUp size={14} /> Escalate for Approval
                            </button>
                          {/if}
                          <button
                            class="btn btn-error btn-outline btn-sm justify-start gap-2"
                            onclick={quickReject}
                            disabled={statusLoading}
                          >
                            <CircleX size={14} /> Reject Ticket
                          </button>
                        {/if}

                        {#if ticket.status === "in_progress"}
                          <button
                            class="btn btn-success btn-sm justify-start gap-2 shadow-sm"
                            onclick={quickResolve}
                            disabled={statusLoading}
                          >
                            <CheckCheck size={14} /> Resolve Ticket
                          </button>
                          <button
                            class="btn btn-secondary btn-sm justify-start gap-2 shadow-sm"
                            onclick={() => updateStatus("pending_hard_copy")}
                            disabled={statusLoading}
                          >
                            <FileText size={14} /> Need Hard Copy
                          </button>
                          {#if !ticket.requires_approval && !ticket.escalated_to_approval}
                            <button
                              class="btn btn-accent btn-sm justify-start gap-2 shadow-sm"
                              onclick={escalateTicket}
                              disabled={statusLoading}
                            >
                              <CircleArrowUp size={14} /> Escalate for Approval
                            </button>
                          {/if}
                          <button
                            class="btn btn-ghost btn-sm justify-start gap-2 border border-base-300"
                            onclick={() => updateStatus("open")}
                            disabled={statusLoading}
                          >
                            <Pause size={14} /> Put on Hold (Open)
                          </button>
                        {/if}

                        {#if ticket.status === "pending_approval"}
                          <div
                            class="p-2 rounded bg-base-200 text-[10px] opacity-70 italic mb-1"
                          >
                            Waiting for approver decision...
                          </div>
                          <button
                            class="btn btn-ghost btn-sm justify-start gap-2 border border-base-300"
                            onclick={() => updateStatus("in_progress")}
                            disabled={statusLoading}
                          >
                            <Undo2 size={14} /> Cancel Approval
                          </button>
                        {/if}

                        {#if ticket.status === "pending_hard_copy"}
                          <button
                            class="btn btn-success btn-sm justify-start gap-2 shadow-sm"
                            onclick={quickResolve}
                            disabled={statusLoading}
                          >
                            <FilePenLine size={14} /> Form Received & Resolve
                          </button>
                          <button
                            class="btn btn-ghost btn-sm justify-start gap-2 border border-base-300"
                            onclick={() => updateStatus("in_progress")}
                            disabled={statusLoading}
                          >
                            <Undo2 size={14} /> Back to Progress
                          </button>
                        {/if}

                        {#if ticket.status === "resolved"}
                          {#if canClose}
                            <button
                              class="btn btn-neutral btn-sm justify-start gap-2 shadow-sm"
                              onclick={quickClose}
                              disabled={statusLoading}
                            >
                              <Lock size={14} /> Close Ticket
                            </button>
                          {/if}
                          {#if canReopen}
                            <button
                              class="btn btn-ghost btn-sm justify-start gap-2 border border-base-300"
                              onclick={quickReopen}
                              disabled={statusLoading}
                            >
                              <CircleArrowUp size={14} /> Reopen Ticket
                            </button>
                          {/if}
                        {/if}

                        {#if (ticket.status === "closed" || ticket.status === "rejected") && canReopen}
                          <button
                            class="btn btn-ghost btn-sm justify-start gap-2 border border-base-300"
                            onclick={quickReopen}
                            disabled={statusLoading}
                          >
                            <CircleArrowUp size={14} /> Reopen Ticket
                          </button>
                        {/if}
                      </div>
                    </div>

                    <div class="divider my-1 opacity-20"></div>

                    <div class="space-y-2">
                      <div class="flex items-center justify-between">
                        <span
                          class="text-[10px] font-bold uppercase tracking-wider text-base-content/40"
                        >
                          Assign Technical Staff
                        </span>
                        {#if ticket.assignee_id}
                          <button
                            class="btn btn-ghost btn-xs text-error p-0 h-auto min-h-0"
                            onclick={() => assignTicket(null)}
                            disabled={statusLoading}
                          >
                            Unassign
                          </button>
                        {/if}
                      </div>

                      <div class="relative">
                        <Search
                          size={12}
                          class="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-30"
                        />
                        <input
                          type="text"
                          class="input input-bordered input-xs w-full pl-8"
                          placeholder="Search staff..."
                          bind:value={assigneeSearch}
                        />
                      </div>

                      <div
                        class="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 bg-base-200/30 rounded-lg p-1"
                      >
                        {#each filteredAssignees as staff (staff.id)}
                          {@const isSelected =
                            Number(ticket.assignee_id) === Number(staff.id)}
                          <button
                            class="btn btn-xs justify-start gap-2 h-8 {isSelected
                              ? 'btn-primary'
                              : 'btn-ghost'}"
                            onclick={() => assignTicket(staff.id)}
                            disabled={statusLoading || isSelected}
                          >
                            <div class="avatar avatar-placeholder">
                              <div
                                class="bg-neutral text-neutral-content w-5 h-5 rounded-full"
                              >
                                <span class="text-[8px]"
                                  >{staff.first_name[0]}{staff
                                    .last_name[0]}</span
                                >
                              </div>
                            </div>
                            <div class="flex flex-col items-start min-w-0">
                              <span
                                class="text-[10px] font-bold truncate w-full"
                                >{staff.first_name} {staff.last_name}</span
                              >
                              <span
                                class="text-[8px] opacity-50 truncate w-full"
                                >@{staff.username}</span
                              >
                            </div>
                            {#if isSelected}
                              <UserCheck size={12} class="ml-auto" />
                            {/if}
                          </button>
                        {:else}
                          <div class="text-center py-4 opacity-40 text-[10px]">
                            No staff found
                          </div>
                        {/each}
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Image zoom modal -->
{#if selectedZoomImage}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 animate-in fade-in duration-200"
    onclick={() => (selectedZoomImage = null)}
  >
    <button
      class="absolute top-4 right-4 btn btn-circle btn-ghost text-white"
      onclick={() => (selectedZoomImage = null)}
    >
      <CircleX size={28} />
    </button>
    <img
      src={`${API_BASE}${selectedZoomImage}`}
      alt="Zoomed preview"
      class="max-w-full max-h-full object-contain shadow-2xl animate-in zoom-in-95 duration-200"
    />
  </div>
{/if}
