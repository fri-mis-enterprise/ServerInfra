<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from "svelte";
  import { decideApproval } from "../../lib/ticket-actions.remote";
  import { getPendingApprovals } from "../../lib/tickets.remote";
  import type { TicketApprover } from "../../lib/types";
  import { simplePrompt, triggerAlert } from "../../stores/ui.svelte";
  import StatusBadge from "../../components/StatusBadge.svelte";
  import {
    CircleCheckBig,
    CircleX,
    ClipboardCheck,
    Clock,
    Eye,
    ChevronUp,
    User,
    Tag,
  } from "lucide-svelte";

  let approvals = $state<(TicketApprover & { ticket?: any })[]>([]);
  let loading = $state(true);
  let expandedId = $state<number | null>(null);

  onMount(async () => {
    try {
      await getPendingApprovals().refresh();
      const res = await getPendingApprovals();
      if (res) approvals = res;
    } catch (error) {
      triggerAlert(error instanceof Error ? error.message : 'Failed to load approvals', 'error');
    }
    loading = false;
  });

  async function decide(
    approval: TicketApprover,
    decision: "approved" | "rejected",
  ) {
    const remarks = await simplePrompt(
      `Remarks for ${decision}: (Optional)`,
      "Add any internal remarks...",
    );
    // If user clicks Cancel, prompt returns null.
    if (remarks === null) return;

    try {
      await decideApproval({ id: approval.id,
        ticket_id: approval.ticket_id,
        decision,
        remarks: remarks || undefined,
      });
      // Remove from list
      approvals = approvals.filter((a) => a.id !== approval.id);
    } catch (error) {
      triggerAlert(error instanceof Error ? error.message : 'Failed to record approval', 'error');
    }
  }

  function toggleExpand(id: number) {
    expandedId = expandedId === id ? null : id;
  }
</script>

<div class="flex flex-col gap-6 max-w-5xl mx-auto w-full px-4">
  <div class="flex flex-col">
    <div class="flex items-center gap-3 mb-1">
      <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
        <ClipboardCheck size={18} />
      </div>
      <h1 class="text-3xl font-bold tracking-tight">My Approvals</h1>
    </div>
    <p class="text-xs opacity-60 font-medium max-w-2xl">
      Manage pending authorizations and review ticket requests requiring your approval.
    </p>
  </div>

  {#if loading}
    <div class="flex justify-center py-20">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
  {:else if approvals.length === 0}
    <div class="card bg-base-100 border border-base-300 shadow-sm">
      <div class="card-body items-center text-center py-16">
        <ClipboardCheck size={48} class="opacity-20 mb-2" />
        <h2 class="text-lg font-semibold opacity-60">All caught up!</h2>
        <p class="text-sm opacity-40">No pending approvals at this time.</p>
      </div>
    </div>
  {:else}
    <div class="grid gap-4">
      {#each approvals as approval (approval.id)}
        <div
          class="card bg-base-100 border border-base-300 shadow-sm hover:shadow-md transition-all overflow-hidden"
        >
          <div class="card-body p-5 gap-4">
            <div
              class="flex flex-col md:flex-row md:items-start justify-between gap-4"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-[10px] font-mono opacity-50"
                    >#{approval.ticket_id}</span
                  >
                  {#if approval.ticket?.status}
                    <StatusBadge status={approval.ticket.status} />
                  {/if}
                </div>
                <a
                  href="{resolve('/')}tickets/{approval.ticket_id}"
                  class="text-xl font-bold hover:text-primary transition-colors block leading-tight"
                >
                  {approval.ticket?.title ?? `Ticket #${approval.ticket_id}`}
                </a>

                <div
                  class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs opacity-60"
                >
                  <div class="flex items-center gap-1">
                    <Clock size={12} />
                    <span
                      >Requested {new Date(
                        approval.created_at,
                      ).toLocaleDateString()}</span
                    >
                  </div>
                  {#if approval.ticket?.requester}
                    <div class="flex items-center gap-1">
                      <User size={12} />
                      <span
                        >By {approval.ticket.requester.first_name}
                        {approval.ticket.requester.last_name}</span
                      >
                    </div>
                  {/if}
                  {#if approval.ticket?.request_type}
                    <div class="flex items-center gap-1">
                      <Tag size={12} />
                      <span>{approval.ticket.request_type.name}</span>
                    </div>
                  {/if}
                </div>
              </div>

              <div class="flex gap-2 items-center">
                <button
                  class="btn btn-ghost btn-sm gap-2"
                  onclick={() => toggleExpand(approval.id)}
                >
                  {#if expandedId === approval.id}
                    <ChevronUp size={16} /> Hide
                  {:else}
                    <Eye size={16} /> Preview
                  {/if}
                </button>
                <div class="w-px h-8 bg-base-300 hidden md:block"></div>
                <button
                  class="btn btn-success btn-sm gap-2 px-5"
                  onclick={() => decide(approval, "approved")}
                >
                  <CircleCheckBig size={16} /> Approve
                </button>
                <button
                  class="btn btn-error btn-sm gap-2 px-5"
                  onclick={() => decide(approval, "rejected")}
                >
                  <CircleX size={16} /> Reject
                </button>
              </div>
            </div>

            {#if expandedId === approval.id}
              <div
                class="mt-2 p-4 bg-base-200/50 rounded-xl animate-in fade-in slide-in-from-top-2"
              >
                <h4
                  class="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-2"
                >
                  Ticket Description
                </h4>
                <p class="text-sm leading-relaxed whitespace-pre-wrap">
                  {@html approval.ticket?.description ??
                    "No description provided."}
                </p>
                <div
                  class="mt-4 pt-4 border-t border-base-300 flex justify-end"
                >
                  <a
                    href="{resolve('/')}tickets/{approval.ticket_id}"
                    class="btn btn-link btn-xs text-primary no-underline"
                    >View Full Ticket History →</a
                  >
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
