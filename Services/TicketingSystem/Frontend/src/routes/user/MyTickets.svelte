<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { getTickets } from "../../lib/tickets.remote";
  import { triggerAlert } from "../../stores/ui.svelte";
  import { location } from "../../lib/location.svelte";
  import type { Ticket } from "../../lib/types";
  import TicketTable from "../../components/TicketTable.svelte";
  import Pagination from "../../components/Pagination.svelte";
  import { hasRole } from "../../stores/user.svelte";
  import { Plus, Search, ListTodo } from "lucide-svelte";
  import { getCurrentUser } from "../../stores/user.svelte";
  import { route, navigate } from "../../router.svelte";
  import { replaceState } from '$app/navigation';
  import { resolve } from '$app/paths';

  const query = $derived(new URLSearchParams(location.search));

  let activeTab = $state<"requested" | "assigned" | "all">("requested");

  // Filters (for the "all tickets" view when admin/MIS)
  let search = $state("");
  let statusFilter = $state("");
  let priorityFilter = $state("");
  let overdueOnly = $state(false);
  let unratedOnly = $state(false);

  // Sync state with URL on navigation/mount
  $effect(() => {
    // This effect runs when query changes (which is reactive to navigation)
    const q = query;

    untrack(() => {
      activeTab = (q.get("tab") as any) || "requested";
      search = q.get("search") || "";
      statusFilter = q.get("status") || "";
      priorityFilter = q.get("priority") || "";
      overdueOnly = q.get("overdue") === "true";
      unratedOnly = q.get("unrated") === "true";

      // Trigger loads based on active tab
      loadCurrentTab(1, false);
    });
  });

  // Requested tickets
  let requestedTickets = $state<Ticket[]>([]);
  let requestedPagination = $state({ page: 1, limit: 20, total: 0, pages: 0 });
  let requestedLoading = $state(true);
  let requestedSort = $state("created_at");
  let requestedOrder = $state<"asc" | "desc">("desc");

  // Assigned tickets
  let assignedTickets = $state<Ticket[]>([]);
  let assignedPagination = $state({ page: 1, limit: 20, total: 0, pages: 0 });
  let assignedLoading = $state(true);
  let assignedSort = $state("created_at");
  let assignedOrder = $state<"asc" | "desc">("desc");

  // All tickets (for admin/MIS)
  let allTickets = $state<Ticket[]>([]);
  let allPagination = $state({ page: 1, limit: 20, total: 0, pages: 0 });
  let allLoading = $state(false);
  let allSort = $state("created_at");
  let allOrder = $state<"asc" | "desc">("desc");

  let showAllView = $derived(hasRole("admin", "mis"));

  function updateUrl() {
    const params = new URLSearchParams();
    if (activeTab !== "requested") params.set("tab", activeTab);
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (priorityFilter) params.set("priority", priorityFilter);
    if (overdueOnly) params.set("overdue", "true");
    if (unratedOnly) params.set("unrated", "true");

    const qs = params.toString();
    const currentQs = window.location.search.replace(/^\?/, "");
    if (qs !== currentQs) {
      const newPath = resolve('/my-tickets') + (qs ? `?${qs}` : '');
      replaceState(newPath, {});
    }
  }

  let searchTimeout: any;
  function handleSearchInput() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadCurrentTab(1);
    }, 500);
  }

  onMount(() => {
    // Initial loads for counts
    loadRequested();
    loadAssigned();
    if (showAllView) loadAll();
  });

  async function loadRequested(page = 1) {
    if (!getCurrentUser()) return;
    requestedLoading = true;
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "20");
    params.set("sort", requestedSort);
    params.set("order", requestedOrder);
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (priorityFilter) params.set("priority", priorityFilter);
    if (overdueOnly) params.set("overdue", "true");
    if (unratedOnly) params.set("unrated", "true");

    try {
      const result = getTickets({ ...Object.fromEntries(params), scope: 'requested' });
      await result.refresh();
      const res = await result;
      if (res) {
        requestedTickets = res.data;
        requestedPagination = res.pagination;
      }
    } catch (error) {
      triggerAlert(error instanceof Error ? error.message : 'Failed to load tickets', 'error');
    }
    requestedLoading = false;
  }

  async function loadAssigned(page = 1) {
    if (!getCurrentUser()) return;
    assignedLoading = true;
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "20");
    params.set("sort", assignedSort);
    params.set("order", assignedOrder);
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (priorityFilter) params.set("priority", priorityFilter);
    if (overdueOnly) params.set("overdue", "true");
    if (unratedOnly) params.set("unrated", "true");

    try {
      const result = getTickets({ ...Object.fromEntries(params), scope: 'assigned' });
      await result.refresh();
      const res = await result;
      if (res) {
        assignedTickets = res.data;
        assignedPagination = res.pagination;
      }
    } catch (error) {
      triggerAlert(error instanceof Error ? error.message : 'Failed to load tickets', 'error');
    }
    assignedLoading = false;
  }

  async function loadAll(page = 1) {
    if (!getCurrentUser()) return;
    allLoading = true;
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "20");
    params.set("sort", allSort);
    params.set("order", allOrder);
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (priorityFilter) params.set("priority", priorityFilter);
    if (overdueOnly) params.set("overdue", "true");
    if (unratedOnly) params.set("unrated", "true");

    try {
      const result = getTickets({ ...Object.fromEntries(params), scope: 'all' });
      await result.refresh();
      const res = await result;
      if (res) {
        allTickets = res.data;
        allPagination = res.pagination;
      }
    } catch (error) {
      triggerAlert(error instanceof Error ? error.message : 'Failed to load tickets', 'error');
    }
    allLoading = false;
  }

  function handleRequestedSort(field: string) {
    if (requestedSort === field) {
      requestedOrder = requestedOrder === "asc" ? "desc" : "asc";
    } else {
      requestedSort = field;
      requestedOrder = "asc";
    }
    loadRequested(1);
    updateUrl();
  }

  function handleAssignedSort(field: string) {
    if (assignedSort === field) {
      assignedOrder = assignedOrder === "asc" ? "desc" : "asc";
    } else {
      assignedSort = field;
      assignedOrder = "asc";
    }
    loadAssigned(1);
    updateUrl();
  }

  function handleAllSort(field: string) {
    if (allSort === field) {
      allOrder = allOrder === "asc" ? "desc" : "asc";
    } else {
      allSort = field;
      allOrder = "asc";
    }
    loadAll(1);
    updateUrl();
  }

  function loadCurrentTab(page = 1, shouldUpdateUrl = true) {
    if (shouldUpdateUrl) updateUrl();
    if (activeTab === "requested") loadRequested(page);
    else if (activeTab === "assigned") loadAssigned(page);
    else if (activeTab === "all") loadAll(page);
  }

  function handleSearch() {
    loadCurrentTab(1);
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div class="flex flex-col">
      <div class="flex items-center gap-3 mb-1">
        <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <ListTodo size={18} />
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">My Tickets</h1>
      </div>
      <p class="text-xs opacity-60 font-medium">Track and manage your service requests and assigned tasks.</p>
    </div>
    <a href="{resolve('/')}tickets/new" class="btn btn-primary gap-2 shadow-none">
      <Plus size={18} /> New Ticket
    </a>
  </div>

  <!-- Tabs -->
  <div role="tablist" class="tabs tabs-bordered">
    <button
      role="tab"
      class="tab"
      class:tab-active={activeTab === "requested"}
      onclick={() => {
        activeTab = "requested";
        loadCurrentTab(1);
      }}
    >
      My Requests ({requestedPagination.total})
    </button>
    <button
      role="tab"
      class="tab"
      class:tab-active={activeTab === "assigned"}
      onclick={() => {
        activeTab = "assigned";
        loadCurrentTab(1);
      }}
    >
      Assigned to Me ({assignedPagination.total})
    </button>
    {#if showAllView}
      <button
        role="tab"
        class="tab"
        class:tab-active={activeTab === "all"}
        onclick={() => {
          activeTab = "all";
          loadCurrentTab(1);
        }}
      >
        All Tickets
      </button>
    {/if}
  </div>

  <!-- Filters -->
  <div
    class="card bg-base-200 border border-base-300 shadow-sm overflow-hidden"
  >
    <div class="p-3">
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleSearch();
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
            id="search-input"
            type="text"
            class="input input-bordered input-sm join-item flex-1 focus:outline-none text-xs"
            placeholder="Search tickets..."
            bind:value={search}
            oninput={handleSearchInput}
          />
          <select
            class="select select-bordered select-sm join-item w-auto hidden sm:block focus:outline-none whitespace-nowrap text-xs shrink-0 min-w-fit bg-none appearance-none pr-3"
            bind:value={statusFilter}
            onchange={() => loadCurrentTab(1)}
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            class="select select-bordered select-sm join-item w-auto hidden md:block focus:outline-none whitespace-nowrap text-xs shrink-0 min-w-fit bg-none appearance-none pr-3"
            bind:value={priorityFilter}
            onchange={() => loadCurrentTab(1)}
          >
            <option value="">All Priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <button
            type="submit"
            class="btn btn-primary btn-sm join-item px-6 text-xs">Find</button
          >
        </div>

        <div class="flex items-center gap-4 w-full md:w-auto px-1">
          <label
            class="label cursor-pointer gap-2 text-xs font-bold uppercase tracking-wider opacity-70"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-sm checkbox-error"
              bind:checked={overdueOnly}
              onchange={() => loadCurrentTab(1)}
            />
            SLA Breached
          </label>

          <label
            class="label cursor-pointer gap-2 text-xs font-bold uppercase tracking-wider opacity-70"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-sm checkbox-warning"
              bind:checked={unratedOnly}
              onchange={() => loadCurrentTab(1)}
            />
            Unrated
          </label>

          <!-- Mobile-only filters dropdown (optional but clean) -->
          <div class="dropdown dropdown-end md:hidden ml-auto">
            <div tabindex="0" role="button" class="btn btn-ghost btn-sm">
              Filters
            </div>
            <ul
              tabindex="-1"
              class="dropdown-content menu bg-base-200 rounded-box z-1 w-52 p-2 shadow-lg border border-base-300 mt-2"
            >
              <li>
                <span class="menu-title text-[10px] font-black uppercase"
                  >Status</span
                >
              </li>
              {#each ["open", "in_progress", "pending_approval", "resolved", "closed", "rejected"] as s}
                <li>
                  <button
                    class="whitespace-nowrap"
                    class:active={statusFilter === s}
                    onclick={() => {
                      statusFilter = s;
                      loadCurrentTab(1);
                    }}>{s.replace("_", " ")}</button
                  >
                </li>
              {/each}
            </ul>
          </div>
        </div>
      </form>
    </div>
  </div>

  <!-- Table -->
  <div class="card bg-base-200 shadow-sm">
    <div class="card-body p-0">
      {#if activeTab === "requested"}
        {#if requestedLoading}
          <div class="flex justify-center py-12">
            <span class="loading loading-spinner loading-lg text-primary"
            ></span>
          </div>
        {:else}
          <TicketTable
            tickets={requestedTickets}
            showAssignee={true}
            sort={requestedSort}
            order={requestedOrder}
            onSort={handleRequestedSort}
          />
          <div class="flex justify-center p-4">
            <Pagination
              pagination={requestedPagination}
              onPageChange={loadRequested}
            />
          </div>
        {/if}
      {:else if activeTab === "assigned"}
        {#if assignedLoading}
          <div class="flex justify-center py-12">
            <span class="loading loading-spinner loading-lg text-primary"
            ></span>
          </div>
        {:else}
          <TicketTable
            tickets={assignedTickets}
            showRequester={true}
            showAssignee={true}
            sort={assignedSort}
            order={assignedOrder}
            onSort={handleAssignedSort}
          />
          <div class="flex justify-center p-4">
            <Pagination
              pagination={assignedPagination}
              onPageChange={loadAssigned}
            />
          </div>
        {/if}
      {:else if allLoading}
        <div class="flex justify-center py-12">
          <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>
      {:else}
        <TicketTable
          tickets={allTickets}
          showRequester={true}
          showAssignee={true}
          sort={allSort}
          order={allOrder}
          onSort={handleAllSort}
        />
        <div class="flex justify-center p-4">
          <Pagination pagination={allPagination} onPageChange={loadAll} />
        </div>
      {/if}
    </div>
  </div>
</div>
