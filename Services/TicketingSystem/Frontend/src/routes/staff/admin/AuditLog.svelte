<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from "svelte";
  import { getAuthAudit, getTicketAudit } from "../../../lib/audit.remote";
  import { triggerAlert } from "../../../stores/ui.svelte";
  import Pagination from "../../../components/Pagination.svelte";
  import { Search, ScrollText } from "lucide-svelte";

  let activeTab = $state<"ticket" | "auth">("ticket");

  // Ticket audit
  let ticketLogs = $state<Awaited<ReturnType<typeof getTicketAudit>>['data']>([]);
  let ticketPagination = $state({ page: 1, limit: 30, total: 0, pages: 0 });
  let ticketLoading = $state(true);
  let ticketIdFilter = $state("");
  let actionFilter = $state("");

  // Auth audit
  let authLogs = $state<Awaited<ReturnType<typeof getAuthAudit>>['data']>([]);
  let authPagination = $state({ page: 1, limit: 30, total: 0, pages: 0 });
  let authLoading = $state(true);
  let authActionFilter = $state("");

  const ticketActions = [
    "status_change",
    "assignment",
    "title_changed",
    "description_changed",
    "priority_changed",
    "comment_added",
    "comment_deleted",
    "attachment_uploaded",
    "attachment_deleted",
    "approvers_added",
    "approver_removed",
    "approval_decision",
    "csat_submitted",
  ];

  const authActions = [
    "user_registered",
    "user_login",
    "user_login_failed",
    "user_logout",
  ];

  $effect(() => {
    if (activeTab === "ticket" && !ticketIdFilter && !actionFilter) {
      loadTicketAudit(1);
    }
  });

  $effect(() => {
    if (activeTab === "auth" && !authActionFilter) {
      loadAuthAudit(1);
    }
  });

  onMount(() => {
    loadTicketAudit();
    loadAuthAudit();
  });

  async function loadTicketAudit(page = 1) {
    ticketLoading = true;
    try {
      const result = getTicketAudit({ page, limit: 30, ticket_id: ticketIdFilter ? Number(ticketIdFilter) : undefined,
        action: actionFilter || undefined, exclude_action: actionFilter ? undefined : 'comment_added' });
      await result.refresh();
      const res = await result;
      if (res) {
        ticketLogs = res.data;
        ticketPagination = res.pagination;
      }
    } catch (error) {
      triggerAlert(error instanceof Error ? error.message : 'Failed to load audit history', 'error');
    }
    ticketLoading = false;
  }

  async function loadAuthAudit(page = 1) {
    authLoading = true;
    try {
      const result = getAuthAudit({ page, limit: 30, action: authActionFilter || undefined });
      await result.refresh();
      const res = await result;
      if (res) {
        authLogs = res.data;
        authPagination = res.pagination;
      }
    } catch (error) {
      triggerAlert(error instanceof Error ? error.message : 'Failed to load authentication history', 'error');
    }
    authLoading = false;
  }

  function formatDate(d: string): string {
    return new Date(d).toLocaleString();
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex flex-col">
    <div class="flex items-center gap-3 mb-1">
      <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
        <ScrollText size={18} />
      </div>
      <h1 class="text-3xl font-bold tracking-tight">Audit Log</h1>
    </div>
    <p class="text-xs opacity-60 font-medium max-w-2xl">Complete historical record of system activity, ticket modifications, and authentication events.</p>
  </div>

  <!-- Tabs -->
  <div role="tablist" class="tabs tabs-bordered">
    <button
      role="tab"
      class="tab"
      class:tab-active={activeTab === "ticket"}
      onclick={() => (activeTab = "ticket")}
    >
      Ticket Activity
    </button>
    <button
      role="tab"
      class="tab"
      class:tab-active={activeTab === "auth"}
      onclick={() => (activeTab = "auth")}
    >
      Auth Activity
    </button>
  </div>

  {#if activeTab === "ticket"}
    <!-- Ticket audit filters -->
    <div
      class="card bg-base-200 border border-base-300 shadow-sm overflow-hidden mb-4"
    >
      <div class="p-3">
        <form
          onsubmit={(e) => {
            e.preventDefault();
            loadTicketAudit(1);
          }}
          class="flex flex-col md:flex-row gap-3 items-center w-full"
        >
          <div class="join w-full flex-1 flex-nowrap">
            <div
              class="join-item flex items-center px-3 bg-base-100 border border-base-300 border-r-0"
            >
              <Search size={14} class="opacity-50" />
            </div>
            <input
              type="number"
              class="input input-bordered input-sm join-item w-32 focus:outline-none text-xs"
              placeholder="Ticket ID"
              bind:value={ticketIdFilter}
            />
            <select
              class="select select-bordered select-sm join-item flex-1 focus:outline-none whitespace-nowrap text-xs shrink-0 min-w-fit bg-none appearance-none pr-3"
              bind:value={actionFilter}
              onchange={() => loadTicketAudit(1)}
            >
              <option value="">All Ticket Actions</option>
              {#each ticketActions as action}
                <option value={action}>{action.replace(/_/g, " ")}</option>
              {/each}
            </select>
            <button
              type="submit"
              class="btn btn-primary btn-sm join-item px-6 text-xs"
              >Filter</button
            >
          </div>
        </form>
      </div>
    </div>

    <!-- Ticket audit table -->
    <div class="card bg-base-200 shadow-sm">
      <div class="card-body p-0">
        {#if ticketLoading}
          <div class="flex justify-center py-12">
            <span class="loading loading-spinner loading-lg text-primary"
            ></span>
          </div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Ticket</th>
                  <th>Action</th>
                  <th>Change</th>
                  <th>By</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {#each ticketLogs as log (log.id)}
                  <tr class="hover:bg-base-300/30">
                    <td class="text-xs opacity-60 whitespace-nowrap"
                      >{formatDate(log.created_at)}</td
                    >
                    <td>
                      {#if log.ticket_id}
                        <a
                          href="{resolve('/')}tickets/{log.ticket_id}"
                          class="link link-primary font-mono text-xs"
                          >#{log.ticket_id}</a
                        >
                      {:else}
                        —
                      {/if}
                    </td>
                    <td
                      ><span class="badge badge-sm badge-ghost"
                        >{log.action.replace(/_/g, " ")}</span
                      ></td
                    >
                    <td class="text-sm">
                      {#if log.old_value || log.new_value}
                        <span class="opacity-50">{log.old_value ?? "—"}</span>
                        <span class="mx-1">→</span>
                        <span class="font-medium">{log.new_value ?? "—"}</span>
                      {:else}
                        —
                      {/if}
                    </td>
                    <td class="text-sm"
                      >{log.performed_by
                        ? `${log.performed_by.first_name} ${log.performed_by.last_name}`
                        : "System"}</td
                    >
                    <td class="text-xs opacity-60 max-w-[200px] truncate"
                      >{log.notes ?? ""}</td
                    >
                  </tr>
                {:else}
                  <tr
                    ><td colspan="6" class="text-center py-8 opacity-50"
                      >No audit entries</td
                    ></tr
                  >
                {/each}
              </tbody>
            </table>
          </div>
          <div class="flex justify-center p-4">
            <Pagination
              pagination={ticketPagination}
              onPageChange={loadTicketAudit}
            />
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Auth audit filters -->
    <div
      class="card bg-base-200 border border-base-300 shadow-sm overflow-hidden mb-4"
    >
      <div class="p-3">
        <form
          onsubmit={(e) => {
            e.preventDefault();
            loadAuthAudit(1);
          }}
          class="flex flex-col md:flex-row gap-3 items-center w-full"
        >
          <div class="join w-full flex-1 flex-nowrap">
            <div
              class="join-item flex items-center px-3 bg-base-100 border border-base-300 border-r-0"
            >
              <Search size={14} class="opacity-50" />
            </div>
            <select
              class="select select-bordered select-sm join-item flex-1 focus:outline-none whitespace-nowrap text-xs shrink-0 min-w-fit bg-none appearance-none pr-3"
              bind:value={authActionFilter}
              onchange={() => loadAuthAudit(1)}
            >
              <option value="">All Auth Actions</option>
              {#each authActions as action}
                <option value={action}>{action.replace(/_/g, " ")}</option>
              {/each}
            </select>
            <button
              type="submit"
              class="btn btn-primary btn-sm join-item px-6 text-xs"
              >Filter</button
            >
          </div>
        </form>
      </div>
    </div>

    <!-- Auth audit table -->
    <div class="card bg-base-200 shadow-sm">
      <div class="card-body p-0">
        {#if authLoading}
          <div class="flex justify-center py-12">
            <span class="loading loading-spinner loading-lg text-primary"
            ></span>
          </div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>User</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {#each authLogs as log (log.id)}
                  <tr class="hover:bg-base-300/30">
                    <td class="text-xs opacity-60 whitespace-nowrap"
                      >{formatDate(log.created_at)}</td
                    >
                    <td
                      ><span class="badge badge-sm badge-ghost"
                        >{log.action.replace(/_/g, " ")}</span
                      ></td
                    >
                    <td class="text-sm"
                      >{log.performed_by
                        ? `${log.performed_by.first_name} ${log.performed_by.last_name}`
                        : "—"}</td
                    >
                    <td class="text-xs opacity-60 max-w-[300px] truncate"
                      >{log.notes ?? ""}</td
                    >
                  </tr>
                {:else}
                  <tr
                    ><td colspan="4" class="text-center py-8 opacity-50"
                      >No auth entries</td
                    ></tr
                  >
                {/each}
              </tbody>
            </table>
          </div>
          <div class="flex justify-center p-4">
            <Pagination
              pagination={authPagination}
              onPageChange={loadAuthAudit}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
