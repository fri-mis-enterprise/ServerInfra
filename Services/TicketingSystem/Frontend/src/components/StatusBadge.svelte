<script lang="ts">
  import type { TicketStatus } from "../lib/types";

  let { status, suffix }: { status: TicketStatus; suffix?: string } = $props();

  const statusMap: Record<TicketStatus, { label: string; class: string }> = {
    open: { label: "Open", class: "badge-info" },
    in_progress: { label: "In Progress", class: "badge-warning" },
    pending_approval: { label: "Pending Approval", class: "badge-accent" },
    pending_hard_copy: { label: "Pending Hard Copy", class: "badge-secondary" },
    resolved: { label: "Resolved", class: "badge-success" },
    closed: { label: "Closed", class: "badge-neutral" },
    rejected: { label: "Rejected", class: "badge-error" },
  };

  let config = $derived(statusMap[status] ?? { label: status, class: "badge-ghost" });
</script>

<div class="badge badge-soft badge-sm whitespace-nowrap inline-flex items-center justify-center shrink-0 {config.class}">
  {config.label}{suffix ? ` (${suffix})` : ""}
</div>
