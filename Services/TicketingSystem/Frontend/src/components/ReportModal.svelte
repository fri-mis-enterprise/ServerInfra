<script lang="ts">
  import {
    Star,
    Clock,
    CheckCircle,
    AlertTriangle,
    Printer,
    X,
    User,
    Building,
  } from "lucide-svelte";
  import { closeModal } from "../stores/ui.svelte";

  export let data: any;
  export let month: string = "";

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
</script>

<div
  class="report-container bg-white text-slate-900 overflow-y-auto max-h-[95vh] rounded-xl relative no-scrollbar mx-auto border border-slate-200"
>
  <!-- UI Actions (Hidden on Print) -->
  <div
    class="sticky top-0 z-20 bg-slate-100/90 backdrop-blur p-3 flex justify-between items-center border-b print:hidden"
  >
    <div class="flex items-center gap-2">
      <Printer size={18} class="text-primary" />
      <h2 class="font-bold text-sm text-slate-700">Performance Report</h2>
    </div>
    <div class="flex gap-2">
      <button
        class="btn btn-xs btn-ghost border border-slate-200"
        onclick={() => closeModal(false)}
      >
        <X size={14} /> Close
      </button>
      <button
        class="btn btn-xs btn-primary shadow-sm"
        onclick={handlePrint}
      >
        <Printer size={14} /> Print / Save PDF
      </button>
    </div>
  </div>

  <!-- The Actual Report (Letter Size) -->
  <div
    class="letter-page mx-auto bg-white p-[0.5in] print:p-0"
  >
    <!-- Extreme Compact Header (Line 1) -->
    <div class="flex justify-between items-end border-b border-slate-300 pb-1 mb-2">
      <div class="flex items-center gap-2">
        <h1 class="text-lg font-black uppercase tracking-tighter text-primary italic leading-none">Ticketing System</h1>
        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">MIS Evaluation</span>
      </div>
      <div class="text-[9px] font-bold text-slate-400 uppercase tracking-tight">
        {month ? `Period: ${new Date(month + "-01").toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}` : 'Period: All Time'} 
        • Issued: {new Date().toLocaleDateString()}
      </div>
    </div>

    <!-- Compressed Agent & Score Row (Line 2) -->
    <div class="flex items-center justify-between mb-3 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-primary text-primary-content rounded flex items-center justify-center text-lg font-black">
          {data.agent.first_name[0]}{data.agent.last_name[0]}
        </div>
        <div>
          <h2 class="text-lg font-black text-slate-900 leading-none">{data.agent.first_name} {data.agent.last_name}</h2>
          <p class="text-[9px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mt-1">
            <Building size={10} /> {data.agent.department?.name} • <User size={10} /> @{data.agent.username}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2">
          <span class="text-[9px] font-black text-slate-400 uppercase">Average Rating</span>
          <span class="text-xl font-black text-primary leading-none">{data.summary.average_rating.toFixed(1)}</span>
          <div class="flex gap-0.5">
            {#each Array(5) as _, i}
              <Star 
                size={10} 
                fill={i < Math.round(data.summary.average_rating) ? '#000000' : 'none'} 
                stroke={i < Math.round(data.summary.average_rating) ? '#000000' : '#CBD5E1'} 
                stroke-width={2.5}
              />
            {/each}
          </div>
        </div>
        <div class="flex items-center gap-2 border-l border-slate-200 pl-4">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-tighter">SLA Compliance</span>
          <span class="text-xl font-black {data.summary.sla_compliance_rate >= 90 ? 'text-green-600' : 'text-orange-500'} leading-none">{data.summary.sla_compliance_rate}%</span>
        </div>
      </div>
    </div>

    <!-- Compact Metrics Data Strip (Line 3) -->
    <div class="grid grid-cols-5 gap-2 mb-4">
      <div class="bg-white border border-slate-100 px-3 py-1.5 rounded flex flex-col justify-center">
        <span class="text-[7px] font-black text-slate-400 uppercase leading-none mb-0.5">Volume</span>
        <span class="text-xs font-black text-slate-800">{data.summary.total_resolved_tickets} Resolved</span>
      </div>
      <div class="bg-white border border-slate-100 px-3 py-1.5 rounded flex flex-col justify-center">
        <span class="text-[7px] font-black text-slate-400 uppercase leading-none mb-0.5">Feedback</span>
        <span class="text-xs font-black text-slate-800">{data.summary.total_responses} Surveys</span>
      </div>
      <div class="bg-white border border-slate-100 px-3 py-1.5 rounded flex flex-col justify-center">
        <span class="text-[7px] font-black text-slate-400 uppercase leading-none mb-0.5">Efficiency</span>
        <span class="text-xs font-black text-slate-800">{formatTime(data.summary.avg_resolution_time_ms)} Avg</span>
      </div>
      <!-- Compact Rating Row -->
      <div class="col-span-2 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded flex items-center justify-between">
        <span class="text-[7px] font-black text-slate-400 uppercase leading-none">Distribution</span>
        <div class="flex gap-2">
            {#each [5, 4, 3, 2, 1] as star}
                <div class="flex items-center gap-0.5">
                    <span class="text-[9px] font-black text-slate-700">{star}★</span>
                    <span class="text-[9px] font-bold text-slate-400">({data.distribution[star]})</span>
                </div>
            {/each}
        </div>
      </div>
    </div>

    <!-- Focus: Detailed Feedback Log -->
    <section class="flex-1 min-h-0">
      <div class="section-title flex items-center gap-2 mb-2">
          <div class="h-3 w-1 bg-primary"></div>
          <h4 class="text-[10px] font-black uppercase text-slate-800 tracking-[0.1em]">Detailed Feedback Log</h4>
      </div>
      <div class="table-container overflow-hidden border border-slate-200 rounded-lg">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-50 text-[8px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-200">
              <th class="px-3 py-1.5 w-16">Date</th>
              <th class="px-3 py-1.5 w-16 text-center">Score</th>
              <th class="px-3 py-1.5">Ticket Context & Verbatim Comment</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each data.recent_feedback as feedback}
              <tr class="hover:bg-slate-50/50 transition-colors break-inside-avoid">
                <td class="px-3 py-1.5 text-[9px] font-bold text-slate-400 whitespace-nowrap uppercase">
                  {new Date(feedback.submitted_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </td>
                <td class="px-3 py-1.5">
                  <div class="flex justify-center gap-0.5">
                    {#each Array(5) as _, i}
                      <Star
                        size={7}
                        fill={i < feedback.rating ? "#000000" : "none"}
                        stroke={i < feedback.rating ? "#000000" : "#CBD5E1"}
                        stroke-width={3}
                      />
                    {/each}
                  </div>
                </td>
                <td class="px-3 py-1.5">
                  <p class="text-[9px] font-black text-slate-800 leading-none mb-0.5">
                    {feedback.ticket.title}
                  </p>
                  <p class="text-[10px] text-slate-500 font-medium leading-tight line-clamp-1 italic">
                    "{feedback.comment || "Satisfied with resolution."}"
                  </p>
                </td>
              </tr>
            {:else}
              <tr>
                <td colspan="3" class="px-4 py-8 text-center text-sm text-slate-400 italic">No feedback records found.</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Extreme Compact Footer -->
    <div class="mt-4 pt-3 border-t border-slate-200 flex justify-between items-end text-[7px] font-black uppercase tracking-[0.1em] text-slate-500">
        <div class="space-y-1">
            <p class="text-slate-400 tracking-[0.2em]">Verification ID</p>
            <div class="font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-200 text-[8px]">REP-{data.agent.id}-{Date.now().toString(36).toUpperCase()}</div>
        </div>
        
        <div class="flex gap-8">
            <div class="flex flex-col items-center">
                <div class="w-32 border-b border-slate-400 mb-1"></div>
                <p class="text-slate-900">Authorized Supervisor</p>
            </div>
            <div class="flex flex-col items-center">
                <div class="w-20 border-b border-slate-400 mb-1"></div>
                <p>Date Signed</p>
            </div>
        </div>
        
        <div class="text-right italic text-primary opacity-80 text-[8px]">
            Ticketing Performance System
        </div>
    </div>
  </div>
</div>

<style>
  .report-container {
    width: min(95vw, 9.5in);
    scrollbar-width: none;
    box-shadow: none !important;
  }
  .report-container::-webkit-scrollbar {
    display: none;
  }
  .letter-page {
    width: 8.5in;
    min-height: 11in;
    display: flex;
    flex-direction: column;
    box-shadow: none !important;
  }

  @media print {
    @page {
      size: letter;
      margin: 0;
    }

    :global(#app > .drawer), 
    :global(.drawer), 
    :global(nav), 
    :global(aside), 
    :global(.modal-backdrop),
    :global(.alert-container),
    .sticky {
      display: none !important;
    }

    :global(.modal) {
      position: absolute !important;
      left: 0 !important;
      top: 0 !important;
      display: block !important;
      background: white !important;
      width: 100% !important;
      height: auto !important;
      min-height: 100% !important;
      overflow: visible !important;
      visibility: visible !important;
      opacity: 1 !important;
      padding: 0 !important;
    }

    :global(.modal-box) {
      display: block !important;
      width: 100% !important;
      max-width: none !important;
      background: white !important;
      padding: 0 !important;
      margin: 0 !important;
      box-shadow: none !important;
      overflow: visible !important;
      border: none !important;
    }

    .report-container {
      width: 100% !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      background: white !important;
      border: none !important;
    }

    .letter-page {
      width: 8.5in !important;
      min-height: 11in !important;
      height: auto !important;
      padding: 0.4in !important;
      margin: 0 auto !important;
      display: block !important;
      box-shadow: none !important;
      border: none !important;
      background: white !important;
      overflow: visible !important;
    }

    section {
        break-inside: auto !important;
    }

    .section-title {
        break-after: avoid-page !important;
    }

    tr {
        break-inside: avoid !important;
    }

    thead {
        display: table-header-group !important;
    }

    /* Add margin to 2nd page onwards */
    thead::before {
        content: "";
        display: block;
        height: 0.5in; /* Margin for subsequent pages */
    }

    /* Hide the extra margin on the very first page */
    @page :first {
        margin-top: 0;
    }
    
    .table-container {
        overflow: visible !important;
        border: none !important;
    }

    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      box-shadow: none !important;
    }
  }
</style>
