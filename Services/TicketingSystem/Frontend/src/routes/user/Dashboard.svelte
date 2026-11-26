<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from "svelte";
  import { getDashboardSummary } from "../../lib/reports.remote";
  import { dashboardSortSchema } from "../../lib/validation/reports";
  import type {
    Ticket,
    TicketApprover,
    User,
    DashboardSummary,
  } from "../../lib/types";
  import { getCurrentUser, hasRole } from "../../stores/user.svelte";
  import { triggerAlert } from "../../stores/ui.svelte";
  import TicketTable from "../../components/TicketTable.svelte";
  import StatsCard from "../../components/StatsCard.svelte";
  import Chart from "../../components/Chart.svelte";
  import {
    Inbox,
    TriangleAlert,
    CircleCheckBig,
    Plus,
    ClipboardCheck,
    UserCheck,
    Briefcase,
    LayoutDashboard,
    Star,
  } from "lucide-svelte";

  let user = $derived(getCurrentUser());
  let tickets = $state<Ticket[]>([]);
  let pendingApprovals = $state<TicketApprover[]>([]);
  let unratedTickets = $state<Ticket[]>([]);
  let activeUsers = $state<Awaited<ReturnType<typeof getDashboardSummary>>['activeUsers']>([]);
  let analytics = $state<DashboardSummary["analytics"] | null>(null);
  let loading = $state(true);
  let dashboardSort = $state("created_at");
  let dashboardOrder = $state<"asc" | "desc">("desc");

  // Filters
  let departmentId = $state<number | undefined>(undefined);

  // Stats
  let totalOpen = $state(0);
  let totalInProgress = $state(0);
  let totalOverdue = $state(0);
  let totalResolved = $state(0);
  let totalClosed = $state(0);
  let totalAll = $state(0);
  let totalPendingApprovals = $state(0);
  let totalUnrated = $state(0);
  let totalAssignedToMe = $state(0);
  let totalDepartmentUnassigned = $state(0);

  async function loadDashboardData() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    loading = true;
    try {
      const result = getDashboardSummary({ department_id: departmentId, sort: dashboardSortSchema.parse(dashboardSort), order: dashboardOrder });
      await result.refresh();
      const res = await result;

      if (res) {
        tickets = res.tickets;
        unratedTickets = res.unratedTickets;
        activeUsers = res.activeUsers;
        pendingApprovals = res.pendingApprovals;

        totalOpen = res.stats.totalOpen;
        totalInProgress = res.stats.totalInProgress;
        totalOverdue = res.stats.totalOverdue;
        totalResolved = res.stats.totalResolved;
        totalClosed = res.stats.totalClosed;
        totalAll = res.stats.totalAll;
        totalAssignedToMe = res.stats.totalAssignedToMe;
        totalDepartmentUnassigned = res.stats.totalDepartmentUnassigned;
        totalUnrated = res.stats.totalUnrated;
        totalPendingApprovals = res.stats.totalPendingApprovals;
        analytics = res.analytics;
      }
    } catch (error) {
      triggerAlert(error instanceof Error ? error.message : 'Failed to load dashboard', 'error');
    } finally {
      loading = false;
    }
  }

  function handleDashboardSort(field: string) {
    if (dashboardSort === field) {
      dashboardOrder = dashboardOrder === "asc" ? "desc" : "asc";
    } else {
      dashboardSort = field;
      dashboardOrder = "asc";
    }
    loadDashboardData();
  }

  onMount(async () => {
    await loadDashboardData();
  });

  $effect(() => {
    if (departmentId !== undefined) {
      loadDashboardData();
    }
  });
</script>

<div class="flex flex-col gap-6 pb-6">
  <!-- Header -->
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div class="flex flex-col">
      <div class="flex items-center gap-3 mb-1">
        <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <LayoutDashboard size={18} />
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">Dashboard</h1>
      </div>
      <p class="text-xs opacity-60 font-medium max-w-2xl">
        Welcome back, <span class="text-primary font-bold">{user?.first_name ?? user?.username ?? "User"}</span>. Here's what needs your attention today.
      </p>
    </div>
    <div class="flex gap-2">
      <a
        href="{resolve('/')}tickets/new"
        class="btn btn-primary btn-md shadow-none gap-2"
      >
        <Plus size={20} />
        New Ticket
      </a>
    </div>
  </div>

  <!-- 1. IMMEDIATE ACTION BAR (Top) -->
  {#if totalOverdue > 0 || totalPendingApprovals > 0 || totalUnrated > 0}
    <div class="flex flex-col gap-3">
      <h2 class="text-xs font-semibold opacity-60 px-1">
        Needs attention
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {#if totalOverdue > 0}
          <a
            href="{resolve('/')}my-tickets?tab={hasRole('admin', 'mis')
              ? 'all'
              : 'requested'}&overdue=true"
            class="flex items-center gap-4 p-4 bg-error/10 border border-error/20 rounded-2xl hover:bg-error/15 transition-all group"
          >
            <div
              class="p-3 bg-error text-error-content rounded-xl shadow-none  transition-transform"
            >
              <TriangleAlert size={24} />
            </div>
            <div>
              <div class="text-2xl font-semibold text-error">{totalOverdue}</div>
              <div
                class="text-xs font-semibold opacity-60"
              >
                Overdue Tickets
              </div>
            </div>
          </a>
        {/if}

        {#if hasRole("approver", "admin") && totalPendingApprovals > 0}
          <a
            href="{resolve('/')}approvals"
            class="flex items-center gap-4 p-4 bg-primary/10 border border-primary/20 rounded-2xl hover:bg-primary/15 transition-all group"
          >
            <div
              class="p-3 bg-primary text-primary-content rounded-xl shadow-none  transition-transform"
            >
              <ClipboardCheck size={24} />
            </div>
            <div>
              <div class="text-2xl font-semibold text-primary">
                {totalPendingApprovals}
              </div>
              <div
                class="text-xs font-semibold opacity-60"
              >
                To Approve
              </div>
            </div>
          </a>
        {/if}

        {#if totalUnrated > 0}
          <a
            href="{resolve('/')}my-tickets?tab={hasRole('admin', 'mis')
              ? 'all'
              : 'requested'}&unrated=true"
            class="flex items-center gap-4 p-4 bg-warning/10 border border-warning/20 rounded-2xl hover:bg-warning/15 transition-all group"
          >
            <div
              class="p-3 bg-warning text-warning-content rounded-xl shadow-none  transition-transform"
            >
              <Star size={24} />
            </div>
            <div>
              <div class="text-2xl font-semibold text-warning">{totalUnrated}</div>
              <div
                class="text-xs font-semibold opacity-60"
              >
                Unrated Resolutions
              </div>
            </div>
          </a>
        {/if}
      </div>
    </div>
  {/if}

  <!-- 3. SECONDARY STATS & OPERATIONAL CARDS -->
  <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-4">
    {#if hasRole("admin", "mis")}
      <a href="{resolve('/')}my-tickets?tab=assigned&status=in_progress" class="contents">
        <StatsCard
          icon={UserCheck}
          label="My Workload"
          value={totalAssignedToMe}
          color="secondary"
          sub="Active & Assigned"
        />
      </a>

      {#if user?.department_id}
        <a href="{resolve('/')}my-tickets?tab=all&status=open" class="contents">
          <StatsCard
            icon={Briefcase}
            label="Dept Triage"
            value={totalDepartmentUnassigned}
            color="accent"
            sub="Unassigned in Dept"
          />
        </a>
      {/if}
    {/if}

    <a
      href="{resolve('/')}my-tickets?tab={hasRole('admin', 'mis')
        ? 'all'
        : 'requested'}&status=open"
      class="contents"
    >
      <StatsCard
        icon={Inbox}
        label="Total Open"
        value={totalOpen}
        color="info"
        pct={totalAll > 0 ? Math.round((totalOpen / totalAll) * 100) : 0}
        sub="New & Pending"
      />
    </a>

    <a
      href="{resolve('/')}my-tickets?tab={hasRole('admin', 'mis')
        ? 'all'
        : 'requested'}&status=resolved"
      class="contents"
    >
      <StatsCard
        icon={CircleCheckBig}
        label="Resolved"
        value={totalResolved}
        color="success"
        pct={totalAll > 0 ? Math.round((totalResolved / totalAll) * 100) : 0}
        sub="Resolved all time"
      />
    </a>

    {#if hasRole("admin", "mis")}
      <a href="{resolve('/')}my-tickets?tab=all" class="contents">
        <StatsCard
          icon={LayoutDashboard}
          label="Total Tickets"
          value={totalAll}
          color="neutral"
          sub="All time"
        />
      </a>
    {/if}
  </div>

  <!-- 2. MAIN ANALYTICS SECTION -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Ticket Trends (Line Chart) -->
    <div
      class="lg:col-span-2 card bg-base-100 border border-base-300 shadow-sm overflow-hidden"
    >
      <div
        class="p-5 border-b border-base-300 flex items-center justify-between bg-base-200/60"
      >
        <h2 class="text-sm font-semibold opacity-60">
          Ticket volume
        </h2>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-1.5">
            <div class="size-2 rounded-full bg-primary"></div>
            <span class="text-xs font-bold opacity-60">New</span>
          </div>
          <div class="flex items-center gap-1.5">
            <div class="size-2 rounded-full bg-success"></div>
            <span class="text-xs font-bold opacity-60"
              >Resolved</span
            >
          </div>
        </div>
      </div>
      <div class="p-6 h-80">
        {#if analytics}
          <Chart
            type="line"
            data={{
              labels: analytics.trends.map((t) =>
                new Date(t.date).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                }),
              ),
              datasets: [
                {
                  label: "New Tickets",
                  data: analytics.trends.map((t) => t.new),
                  borderColor: "#338c83", // Teal
                  backgroundColor: "rgba(51, 140, 131, 0.08)",
                  fill: true,
                  tension: 0.4,
                },
                {
                  label: "Resolved",
                  data: analytics.trends.map((t) => t.resolved),
                  borderColor: "#739c42", // Green
                  backgroundColor: "transparent",
                  tension: 0.4,
                },
              ],
            }}
            options={{
              scales: {
                y: { beginAtZero: true, grid: { display: false } },
                x: { grid: { display: false } },
              },
              plugins: { legend: { display: false } },
            }}
          />
        {:else}
          <div
            class="h-full w-full bg-base-300/20 animate-pulse rounded-xl"
          ></div>
        {/if}
      </div>
    </div>

    <!-- Distribution by Type (Doughnut) -->
    <div
      class="card bg-base-100 border border-base-300 shadow-sm overflow-hidden"
    >
      <div class="p-5 border-b border-base-300 bg-base-200/60">
        <h2 class="text-sm font-semibold opacity-60">
          Request mix
        </h2>
      </div>
      <div class="p-6 h-80 flex flex-col items-center justify-center">
        {#if analytics}
          <Chart
            type="doughnut"
            data={{
              labels: analytics.byType.map((t) => t.name),
              datasets: [
                {
                  data: analytics.byType.map((t) => t.count),
                  backgroundColor: [
                    "#338c83", // Teal
                    "#c38c42", // Amber
                    "#739c42", // Green
                    "#6386ad", // Blue
                    "#8e969c", // Slate
                  ],
                  borderWidth: 0,
                },
              ],
            }}
            options={{
              plugins: {
                legend: {
                  position: "bottom",
                  labels: {
                    boxWidth: 12,
                    font: { size: 12, weight: "normal" },
                  },
                },
              },
              cutout: "70%",
            }}
          />
        {:else}
          <div
            class="size-48 rounded-full border-8 border-base-300/30 border-t-primary animate-spin"
          ></div>
        {/if}
      </div>
    </div>
  </div>

  <!-- 4. BOTTOM CONTENT (Recent Tickets & Staff) -->
  <div class="grid grid-cols-1 xl:grid-cols-4 gap-6">
    <!-- Recent Tickets (3/4) -->
    <div class="xl:col-span-3 flex flex-col gap-4">
      <div
        class="card bg-base-100 border border-base-300 shadow-sm overflow-hidden"
      >
        <div
          class="flex flex-wrap items-center justify-between px-6 py-5 border-b border-base-300 gap-4"
        >
          <h2 class="text-lg font-semibold tracking-tight flex items-center gap-2">
            <LayoutDashboard class="text-primary" size={20} />
            Recent tickets
          </h2>
          <div class="flex items-center gap-3 flex-1 justify-end min-w-0">
            <a
              href="{resolve('/')}my-tickets?tab={hasRole('admin', 'mis')
                ? 'all'
                : 'requested'}"
              class="btn btn-ghost btn-sm font-bold text-xs"
              >View all tickets</a
            >
          </div>
        </div>
        {#if loading}
          <div class="flex justify-center py-20">
            <span class="loading loading-spinner loading-lg text-primary"
            ></span>
          </div>
        {:else}
          <div class="p-0 overflow-x-auto">
            <TicketTable
              {tickets}
              showRequester={hasRole("admin", "mis")}
              sort={dashboardSort}
              order={dashboardOrder}
              onSort={handleDashboardSort}
            />
          </div>
        {/if}
      </div>
    </div>

    <!-- Active Staff (1/4) -->
    <div class="flex flex-col gap-6">
      <div
        class="card bg-base-100 border border-base-300 shadow-sm overflow-hidden"
      >
        <div
          class="p-5 border-b border-base-300 bg-base-200/50 flex items-center justify-between"
        >
          <h2 class="text-xs font-semibold opacity-60">
            Online Team
          </h2>
          <div class="flex items-center gap-1.5">
            <div class="w-2 h-2 rounded-full bg-success animate-pulse"></div>
            <span class="text-xs font-semibold opacity-60"
              >{activeUsers.length}</span
            >
          </div>
        </div>
        <div class="card-body p-0 max-h-[400px] overflow-y-auto">
          {#each activeUsers.slice(0, 8) as staff (staff.id)}
            <a
              href="{resolve('/')}messages/{staff.id}"
              class="w-full px-5 py-4 flex items-center gap-4 hover:bg-base-200 transition-colors border-b border-base-200 last:border-0 group"
            >
              <div class="avatar online">
                <div
                  class="w-10 h-10 rounded-xl bg-neutral text-neutral-content flex items-center justify-center text-sm font-semibold"
                >
                  {staff.first_name[0]}{staff.last_name[0]}
                </div>
              </div>
              <div class="flex-1 min-w-0">
                <p
                  class="text-xs font-semibold truncate group-hover:text-primary transition-colors"
                >
                  {staff.first_name}
                  {staff.last_name}
                </p>
                <p class="text-xs font-bold opacity-60 truncate">
                  {staff.position ?? "Technical Support"}
                </p>
              </div>
            </a>
          {:else}
            <div class="p-12 text-center opacity-30 italic text-xs font-medium">
              No staff active
            </div>
          {/each}
        </div>
        <div class="p-4 bg-base-200/30 border-t border-base-200">
          <a
            href="{resolve('/')}messages"
            class="btn btn-ghost btn-xs btn-block gap-2 text-xs font-semibold"
          >
            Open Chat Room
          </a>
        </div>
      </div>
    </div>
  </div>
</div>
