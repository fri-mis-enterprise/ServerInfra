<script lang="ts">
  import { resolve } from '$app/paths';
  import { navigate } from "../router.svelte";
  import type { Ticket } from "../lib/types";
  import StatusBadge from "./StatusBadge.svelte";
  import PriorityBadge from "./PriorityBadge.svelte";
  import { Clock, TriangleAlert, ChevronUp, ChevronDown } from "lucide-svelte";

  let {
    tickets,
    showRequester = false,
    showAssignee = true,
    sort = "created_at",
    order = "desc",
    onSort = (field: string) => {},
  }: {
    tickets: Ticket[];
    showRequester?: boolean;
    showAssignee?: boolean;
    sort?: string;
    order?: "asc" | "desc";
    onSort?: (field: string) => void;
  } = $props();

  function toggleSort(field: string) {
    onSort(field);
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }
</script>

<div class="overflow-x-auto">
  <table class="table table-sm">
    <thead>
      <tr>
        <th class="cursor-pointer hover:bg-base-300 transition-colors select-none" onclick={() => toggleSort('id')}>
          <div class="flex items-center gap-1">
            ID
            {#if sort === 'id'}
              {#if order === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
            {/if}
          </div>
        </th>
        <th class="cursor-pointer hover:bg-base-300 transition-colors select-none" onclick={() => toggleSort('title')}>
          <div class="flex items-center gap-1">
            Title
            {#if sort === 'title'}
              {#if order === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
            {/if}
          </div>
        </th>
        <th class="cursor-pointer hover:bg-base-300 transition-colors select-none" onclick={() => toggleSort('status')}>
          <div class="flex items-center gap-1">
            Status
            {#if sort === 'status'}
              {#if order === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
            {/if}
          </div>
        </th>
        <th class="cursor-pointer hover:bg-base-300 transition-colors select-none" onclick={() => toggleSort('priority')}>
          <div class="flex items-center gap-1">
            Priority
            {#if sort === 'priority'}
              {#if order === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
            {/if}
          </div>
        </th>
        {#if showRequester}<th>Requester</th>{/if}
        {#if showAssignee}<th>Assignee</th>{/if}
        <th class="cursor-pointer hover:bg-base-300 transition-colors select-none" onclick={() => toggleSort('created_at')}>
          <div class="flex items-center gap-1">
            Created
            {#if sort === 'created_at'}
              {#if order === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
            {/if}
          </div>
        </th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each tickets as ticket (ticket.id)}
        <tr
          class="hover:bg-base-200/50 cursor-pointer"
          onclick={() =>
            navigate("/tickets/:id", { params: { id: ticket.id.toString() } })}
        >
          <td class="font-mono text-xs opacity-60">#{ticket.id}</td>
          <td>
            <div class="flex items-center gap-2 max-w-xs">
              <span class="font-medium truncate">{ticket.title}</span>
              {#if ticket.sla_breached}
                <span class="badge badge-error badge-xs gap-1 shrink-0">
                  <TriangleAlert size={10} />
                  SLA
                </span>
              {/if}
            </div>
          </td>
          <td class="whitespace-nowrap"
            ><StatusBadge status={ticket.status} /></td
          >
          <td class="whitespace-nowrap"
            ><PriorityBadge priority={ticket.priority} /></td
          >
          {#if showRequester}
            <td class="text-sm">
              {ticket.requester
                ? `${ticket.requester.first_name} ${ticket.requester.last_name}`
                : "—"}
            </td>
          {/if}
          {#if showAssignee}
            <td class="text-sm">
              {ticket.assignee
                ? `${ticket.assignee.first_name} ${ticket.assignee.last_name}`
                : "Unassigned"}
            </td>
          {/if}
          <td>
            <span class="flex items-center gap-1 text-xs opacity-60">
              <Clock size={12} />
              {timeAgo(ticket.created_at)}
            </span>
          </td>
          <td>
            <a href="{resolve('/')}tickets/{ticket.id}" class="btn btn-ghost btn-xs">View</a>
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="99" class="text-center py-8 opacity-50">
            No tickets found
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
