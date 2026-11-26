<script lang="ts">
  import { onMount } from "svelte";
  import { getTicketReport } from "../../../lib/reports.remote";
  import { getAssignees, getUserDirectory } from "../../../lib/users.remote";
  import { triggerAlert } from "../../../stores/ui.svelte";
  import {
    getDepartments,
    getRequestTypes,
    fetchReferenceData,
  } from "../../../stores/reference.svelte";
  import {
    FileText,
    Download,
    Printer,
    Search,
    Filter,
    Calendar,
    ChevronDown,
    Building2,
    LayoutGrid,
    User,
    Clock,
    CheckCircle2,
    AlertTriangle,
    BarChart3,
    ArrowUpDown,
    Undo2,
    ShieldCheck,
  } from "lucide-svelte";
  import PriorityBadge from "../../../components/PriorityBadge.svelte";
  import StatusBadge from "../../../components/StatusBadge.svelte";
  import type { User as UserType } from "../../../lib/types";

  let loading = $state(false);
  let tickets = $state<any[]>([]);
  let summary = $state<any>({
    total: 0,
    resolved: 0,
    sla_breached: 0,
    sla_compliance_rate: 100,
    avg_resolution_time_ms: 0,
    avg_csat_rating: 0,
  });

  // Filters
  let dateFrom = $state("");
  let dateTo = $state("");
  let status = $state("");
  let priority = $state("");
  let departmentId = $state("");
  let requestTypeId = $state("");
  let assigneeId = $state("");
  let requesterId = $state("");

  // Reference Data
  let assignees = $state<UserType[]>([]);
  let requesters = $state<Awaited<ReturnType<typeof getUserDirectory>>>([]);
  let departments = $derived(getDepartments());
  let requestTypes = $derived(getRequestTypes());

  async function loadReports() {
    loading = true;
    try {
      const result = getTicketReport({
        date_from: dateFrom || undefined, date_to: dateTo || undefined,
        status: status || undefined, priority: priority || undefined,
        department_id: departmentId ? Number(departmentId) : undefined,
        request_type_id: requestTypeId ? Number(requestTypeId) : undefined,
        assignee_id: assigneeId ? Number(assigneeId) : undefined,
        requester_id: requesterId ? Number(requesterId) : undefined,
      });
      await result.refresh();
      const res = await result;
      if (res) {
        tickets = res.tickets;
        summary = res.summary;
      }
    } catch (e: any) {
      triggerAlert(e.message || "Failed to load reports", "error");
    } finally {
      loading = false;
    }
  }

  function resetFilters() {
    dateFrom = "";
    dateTo = "";
    status = "";
    priority = "";
    departmentId = "";
    requestTypeId = "";
    assigneeId = "";
    requesterId = "";
    loadReports();
  }

  function exportToCsv() {
    if (tickets.length === 0) return;

    const headers = [
      "ID",
      "Title",
      "Status",
      "Priority",
      "Department",
      "Type",
      "Requester",
      "Assignee",
      "Created At",
      "Completed At",
      "SLA Breached",
      "CSAT Rating"
    ];

    const rows = tickets.map(t => [
      t.id,
      `"${t.title.replace(/"/g, '""')}"`,
      t.status,
      t.priority,
      t.department?.name || "N/A",
      t.request_type?.name || "N/A",
      `${t.requester?.first_name} ${t.requester?.last_name}`,
      t.assignee ? `${t.assignee.first_name} ${t.assignee.last_name}` : "Unassigned",
      new Date(t.created_at).toLocaleString(),
      t.completed_at ? new Date(t.completed_at).toLocaleString() : "N/A",
      t.sla_breached ? "Yes" : "No",
      t.csat?.rating || "N/A"
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `ticket_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handlePrint() {
    window.print();
  }

  function formatTime(ms: number) {
    if (!ms && ms !== 0) return "0h";
    if (ms < 3600000) return "< 1h";
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h`;
    return `${hours}h`;
  }

  onMount(async () => {
    await Promise.all([
      fetchReferenceData(),
      (async () => {
        try {
          const result = getAssignees({});
          await result.refresh();
          const res = await result;
          if (res) assignees = res;
        } catch {}
      })(),
      (async () => {
        try {
          // Requesters can be any active user
          const result = getUserDirectory();
          await result.refresh();
          const res = await result;
          if (res) requesters = res;
        } catch {}
      })(),
    ]);
    loadReports();
  });
</script>

<div class="flex flex-col gap-6 max-w-7xl mx-auto w-full px-4 lg:px-6 pb-12">
  <!-- Header -->
  <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
    <div>
      <h1 class="text-2xl font-black tracking-tight flex items-center gap-2">
        <BarChart3 class="text-primary" size={28} />
        Ticket Reports & Analytics
      </h1>
      <p class="text-sm opacity-60">Generate custom ticket lists, analyze performance, and export data.</p>
    </div>
    <div class="flex items-center gap-2">
      <button 
        class="btn btn-outline btn-sm gap-2" 
        onclick={exportToCsv}
        disabled={tickets.length === 0 || loading}
      >
        <Download size={16} /> Export CSV
      </button>
      <button 
        class="btn btn-primary btn-sm gap-2 shadow-md" 
        onclick={handlePrint}
        disabled={tickets.length === 0 || loading}
      >
        <Printer size={16} /> Print Report
      </button>
    </div>
  </div>

  <!-- Filters Sidebar/Panel -->
  <div class="card bg-base-100 shadow-sm border border-base-300 print:hidden">
    <div class="card-body p-4 lg:p-6">
      <div class="flex items-center gap-2 mb-4 border-b border-base-200 pb-2">
        <Filter size={16} class="text-primary" />
        <h2 class="font-bold text-sm uppercase tracking-wider">Report Filters</h2>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Date From -->
        <div class="form-control w-full">
          <label class="label py-1" for="rep-date-from">
            <span class="label-text text-[10px] font-bold uppercase opacity-60">Date From</span>
          </label>
          <div class="relative">
            <Calendar class="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" size={14} />
            <input id="rep-date-from" type="date" class="input input-bordered input-sm w-full pl-9" bind:value={dateFrom} />
          </div>
        </div>

        <!-- Date To -->
        <div class="form-control w-full">
          <label class="label py-1" for="rep-date-to">
            <span class="label-text text-[10px] font-bold uppercase opacity-60">Date To</span>
          </label>
          <div class="relative">
            <Calendar class="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" size={14} />
            <input id="rep-date-to" type="date" class="input input-bordered input-sm w-full pl-9" bind:value={dateTo} />
          </div>
        </div>

        <!-- Status -->
        <div class="form-control w-full">
          <label class="label py-1" for="rep-status">
            <span class="label-text text-[10px] font-bold uppercase opacity-60">Status</span>
          </label>
          <select id="rep-status" class="select select-bordered select-sm w-full" bind:value={status}>
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="pending_hard_copy">Pending Hard Copy</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        <!-- Priority -->
        <div class="form-control w-full">
          <label class="label py-1" for="rep-priority">
            <span class="label-text text-[10px] font-bold uppercase opacity-60">Priority</span>
          </label>
          <select id="rep-priority" class="select select-bordered select-sm w-full" bind:value={priority}>
            <option value="">All Priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        <!-- Department -->
        <div class="form-control w-full">
          <label class="label py-1" for="rep-dept">
            <span class="label-text text-[10px] font-bold uppercase opacity-60">Department</span>
          </label>
          <select id="rep-dept" class="select select-bordered select-sm w-full" bind:value={departmentId}>
            <option value="">All Departments</option>
            {#each departments as dept}
              <option value={dept.id}>{dept.name}</option>
            {/each}
          </select>
        </div>

        <!-- Request Type -->
        <div class="form-control w-full">
          <label class="label py-1" for="rep-type">
            <span class="label-text text-[10px] font-bold uppercase opacity-60">Request Type</span>
          </label>
          <select id="rep-type" class="select select-bordered select-sm w-full" bind:value={requestTypeId}>
            <option value="">All Types</option>
            {#each requestTypes as type}
              <option value={type.id}>{type.name}</option>
            {/each}
          </select>
        </div>

        <!-- Assignee -->
        <div class="form-control w-full">
          <label class="label py-1" for="rep-assignee">
            <span class="label-text text-[10px] font-bold uppercase opacity-60">Assignee</span>
          </label>
          <select id="rep-assignee" class="select select-bordered select-sm w-full" bind:value={assigneeId}>
            <option value="">All Staff</option>
            {#each assignees as staff}
              <option value={staff.id}>{staff.first_name} {staff.last_name}</option>
            {/each}
          </select>
        </div>

        <!-- Requester -->
        <div class="form-control w-full">
          <label class="label py-1" for="rep-requester">
            <span class="label-text text-[10px] font-bold uppercase opacity-60">Requester</span>
          </label>
          <select id="rep-requester" class="select select-bordered select-sm w-full" bind:value={requesterId}>
            <option value="">All Requesters</option>
            {#each requesters as req}
              <option value={req.id}>{req.first_name} {req.last_name} (@{req.username})</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="flex justify-end gap-2 mt-6">
        <button class="btn btn-ghost btn-sm gap-2" onclick={resetFilters}>
          <Undo2 size={14} /> Reset Filters
        </button>
        <button class="btn btn-primary btn-sm px-8 gap-2 shadow-sm" onclick={loadReports} disabled={loading}>
          {#if loading}<span class="loading loading-spinner loading-xs"></span>{/if}
          <Search size={14} /> Generate Report
        </button>
      </div>
    </div>
  </div>

  <!-- Summary Stats -->
  <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
    <div class="card bg-base-100 shadow-sm border border-base-300">
      <div class="card-body p-4 items-center text-center">
        <span class="text-[10px] font-bold uppercase opacity-40">Total Tickets</span>
        <span class="text-2xl font-black">{summary.total}</span>
      </div>
    </div>
    <div class="card bg-base-100 shadow-sm border border-base-300">
      <div class="card-body p-4 items-center text-center">
        <span class="text-[10px] font-bold uppercase opacity-40">Resolved</span>
        <span class="text-2xl font-black text-success">{summary.resolved}</span>
      </div>
    </div>
    <div class="card bg-base-100 shadow-sm border border-base-300">
      <div class="card-body p-4 items-center text-center">
        <span class="text-[10px] font-bold uppercase opacity-40">SLA Breach</span>
        <span class="text-2xl font-black text-error">{summary.sla_breached}</span>
      </div>
    </div>
    <div class="card bg-base-100 shadow-sm border border-base-300">
      <div class="card-body p-4 items-center text-center">
        <span class="text-[10px] font-bold uppercase opacity-40">Compliance</span>
        <span class="text-2xl font-black {summary.sla_compliance_rate >= 90 ? 'text-success' : 'text-warning'}">{summary.sla_compliance_rate}%</span>
      </div>
    </div>
    <div class="card bg-base-100 shadow-sm border border-base-300">
      <div class="card-body p-4 items-center text-center">
        <span class="text-[10px] font-bold uppercase opacity-40">Avg Work Time</span>
        <span class="text-2xl font-black">{formatTime(summary.avg_resolution_time_ms)}</span>
      </div>
    </div>
  </div>

  <!-- Data Table -->
  <div class="card bg-base-100 shadow-sm border border-base-300 overflow-hidden">
    <div class="overflow-x-auto">
      <table class="table table-sm table-zebra">
        <thead class="bg-base-200/50">
          <tr>
            <th class="font-bold">ID</th>
            <th class="font-bold">Ticket Info</th>
            <th class="font-bold">Status/Priority</th>
            <th class="font-bold">Categorization</th>
            <th class="font-bold">Parties</th>
            <th class="font-bold">Timeline</th>
            <th class="font-bold text-center">CSAT</th>
          </tr>
        </thead>
        <tbody>
          {#each tickets as ticket (ticket.id)}
            <tr class="hover:bg-base-200/30 transition-colors">
              <td class="font-mono text-xs opacity-60">#{ticket.id}</td>
              <td class="max-w-xs">
                <div class="flex flex-col gap-0.5">
                  <span class="font-bold text-xs truncate">{ticket.title}</span>
                  {#if ticket.sla_breached}
                    <span class="badge badge-error badge-xs gap-1 font-black">
                      <AlertTriangle size={8} /> BREACHED
                    </span>
                  {/if}
                </div>
              </td>
              <td>
                <div class="flex flex-col gap-1">
                  <StatusBadge status={ticket.status} />
                  <PriorityBadge priority={ticket.priority} />
                </div>
              </td>
              <td>
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-1 text-[10px] opacity-60">
                    <Building2 size={10} /> {ticket.department?.name || "N/A"}
                  </div>
                  <div class="flex items-center gap-1 text-[10px] opacity-60">
                    <LayoutGrid size={10} /> {ticket.request_type?.name || "N/A"}
                  </div>
                </div>
              </td>
              <td>
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-1 text-[10px] font-medium">
                    <User size={10} class="opacity-40" /> {ticket.requester?.first_name} {ticket.requester?.last_name}
                  </div>
                  <div class="flex items-center gap-1 text-[10px] {ticket.assignee ? 'font-medium' : 'italic opacity-30'}">
                    <ShieldCheck size={10} class="opacity-40" /> {ticket.assignee ? `${ticket.assignee.first_name} ${ticket.assignee.last_name}` : "Unassigned"}
                  </div>
                </div>
              </td>
              <td>
                <div class="flex flex-col gap-1 text-[10px] opacity-60">
                  <div class="flex items-center gap-1">
                    <Clock size={10} /> Created: {new Date(ticket.created_at).toLocaleDateString()}
                  </div>
                  {#if ticket.completed_at}
                    <div class="flex items-center gap-1 text-success font-medium">
                      <CheckCircle2 size={10} /> Resolved: {new Date(ticket.completed_at).toLocaleDateString()}
                    </div>
                  {/if}
                </div>
              </td>
              <td class="text-center">
                {#if ticket.csat}
                  <div class="badge badge-warning badge-outline font-black text-xs gap-1">
                    {ticket.csat.rating} ★
                  </div>
                {:else}
                  <span class="opacity-20">—</span>
                {/if}
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="7" class="text-center py-20 opacity-40 italic">
                {#if loading}
                  <span class="loading loading-spinner loading-lg"></span>
                {:else}
                  No tickets found matching current filters.
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<style>
  @media print {
    :global(nav), 
    :global(aside), 
    .print\:hidden {
      display: none !important;
    }

    .max-w-7xl {
      max-width: none !important;
      padding: 0 !important;
    }

    .card {
      border: none !important;
      box-shadow: none !important;
    }

    table {
      font-size: 10px !important;
    }

    .badge {
      border: 1px solid #ddd !important;
      print-color-adjust: exact;
    }
  }
</style>
