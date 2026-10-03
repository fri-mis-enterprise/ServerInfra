<script>
  import { onMount } from "svelte";
  import { api, time, months, notice } from "$lib/state";
  import Icon from "$lib/Icon.svelte";
  let data;
  let period = "";
  let search = "";
  let filter = "";
  let error = "";
  let loading = false;
  let requestBusy = false;
  let stopped = false;
  let timer;
  let scanDialog;
  let actionDialog;
  let scanDismissed = false;
  let target = null;
  let actionBusy = false;
  const labels = {
    closed_records_present: "Closing records present",
    open_deleted: "Open · deleted records",
    missing: "No period records",
    mixed: "Mixed records",
    unexpected_dates: "Unexpected dates",
    unverified: "Unverified",
  };
  $: stations = data?.stations || [];
  $: scanActive = ["queued", "scanning"].includes(data?.scan?.state);
  $: actionActive = data?.actions?.some(job => ["queued", "running", "needs_recovery"].includes(job.state)) || false;
  $: currentAction = data?.actions?.find(job => ["queued", "running", "needs_recovery"].includes(job.state));
  $: if (scanActive && !scanDismissed && scanDialog && !scanDialog.open) scanDialog.showModal();
  $: visible = stations.filter(s => s.station.toLowerCase().includes(search.toLowerCase()) && (!filter || s.status === filter));
  $: closed = stations.filter(s => s.status === "closed_records_present").length;
  $: excluded = stations.filter(s => s.generation_excluded && s.status === "missing").length;
  $: attention = stations.filter(s => s.status !== "closed_records_present" && !(s.generation_excluded && s.status === "missing")).length;
  $: periodLabel = period ? `${months[Number(period.slice(5))]} ${period.slice(0, 4)}` : "Selected period";

  async function refresh() {
    if (loading) return;
    const requested = period;
    let changed = false;
    loading = true;
    try {
      const result = await api(`/fast/status${requested ? `?period=${encodeURIComponent(requested)}` : ""}`);
      if (!stopped && requested === period) {
        data = result;
        period = result.period;
        error = "";
      } else if (!stopped) changed = true;
    } catch (e) {
      if (!stopped) error = e.message;
      changed = !stopped && requested !== period;
    } finally {
      loading = false;
      clearTimeout(timer);
      if (!stopped && changed) refresh();
      else if (!stopped && (["queued", "scanning"].includes(data?.scan?.state) || data?.actions?.some(job => ["queued", "running"].includes(job.state)))) timer = setTimeout(refresh, 2000);
    }
  }
  async function requestScan(station = null) {
    if (requestBusy) return;
    requestBusy = true;
    try {
      const result = await api("/fast/scan", { station });
      scanDismissed = false;
      notice(result.message);
    } catch (e) {
      notice(e.message, "error");
    } finally {
      await refresh();
      requestBusy = false;
    }
  }
  function confirmAction(station, action) {
    target = { station, action, period };
    actionDialog.showModal();
  }
  async function submitAction() {
    if (!target || actionBusy) return;
    const requested = target;
    actionBusy = true;
    try {
      const request_id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      await api('/fast/action', { ...requested, request_id });
      actionDialog.close();
      notice(`${requested.action === 'open' ? 'Opening' : 'Closing'} requested for ${requested.station}.`);
    } catch (e) { notice(e.message, 'error'); }
    finally { target = null; actionBusy = false; await refresh(); }
  }
  async function resumeAction(job) {
    if (actionBusy) return;
    actionBusy = true;
    try { await api(`/fast/action/${job.id}/resume`, {}); notice('Recovery requested.'); }
    catch (e) { notice(e.message, 'error'); }
    finally { actionBusy = false; await refresh(); }
  }
  onMount(() => {
    stopped = false;
    refresh();
    return () => { stopped = true; clearTimeout(timer); };
  });
</script>

<svelte:head><title>FAST periods · System Monitor</title></svelte:head>
<div class="page-heading">
  <div>
    <p class="eyebrow">FAST SYSTEM · MONTHLY PERIODS</p>
    <h1>Station periods</h1>
    <p class="page-description">Review saved monthly closing records. Scan stations when you need a fresh check.</p>
  </div>
  <div class="fast-page-actions">
    {#if data?.read_only}<span class="status-pill pill-neutral"><Icon name="lock" />Read-only</span>{/if}
    <button class="button button-primary" on:click={() => requestScan()} disabled={requestBusy || loading || scanActive || actionActive}><Icon name="refresh" />Scan all stations</button>
  </div>
</div>
{#if data?.read_only}<div class="notice notice-warning"><Icon name="shield" /><div><strong>FAST controls are disabled</strong><p>Scanning is available. The administrator must enable FAST writes and provide a writable FAST mount before period controls can run.</p></div></div>{/if}
{#if error}<div class="notice notice-error" role="alert"><Icon name="alert" /><div><strong>Refresh unavailable</strong><p>{error} Displayed results may be out of date.</p></div></div>{/if}
<div class="panel fast-filters">
  <label for="fast-period">Period<input id="fast-period" type="month" min="1900-01" max="2199-12" bind:value={period} on:change={() => { if (period) refresh(); }} required /></label>
  <label for="fast-search">Search stations<input id="fast-search" class="station-search" type="search" placeholder="Type a station name…" bind:value={search} /></label>
  <label for="fast-status">Status<select id="fast-status" bind:value={filter}><option value="">All statuses</option>{#each Object.entries(labels) as [value, label]}<option {value}>{label}</option>{/each}</select></label>
  <button class="button button-secondary" on:click={refresh} disabled={loading}><Icon name="refresh" />Refresh view</button>
</div>
{#if data && data.period === period}
  <div class="metrics">
    <div class="metric"><span class="metric-icon"><Icon name="grid" /></span><div><span class="metric-label">Stations monitored</span><strong>{stations.length}</strong><small>{periodLabel}</small></div></div>
    <div class="metric"><span class="metric-icon tone-green"><Icon name="check" /></span><div><span class="metric-label">Closing records present</span><strong>{closed}</strong><small>{excluded ? `${excluded} station excluded from generation` : "From saved station observations"}</small></div></div>
    <div class="metric"><span class="metric-icon" class:tone-amber={attention > 0}><Icon name="alert" /></span><div><span class="metric-label">Needs review</span><strong>{attention}</strong><small>Open, missing, mixed, or unverified periods</small></div></div>
  </div>
  <div class="refresh-bar" class:refresh-warning={!!data.scan?.error || data.scan?.stalled || !!error}>
    <span class="refresh-message"><span class="status-dot"></span>
      {#if !data.scan}No station scan yet. Choose Scan all stations to begin.
      {:else if data.scan.state === "queued"}Scan queued for {data.scan.station || "all stations"} at {time(data.scan.requested_at)}. Waiting for the scan worker.
      {:else if data.scan.stalled}Station scan has stopped reporting progress. Last update {time(data.scan.updated_at)}.
      {:else if data.scan.state === "error"}Station scan failed. Last successful station results are retained.
      {:else if data.scan.state === "scanning"}Scanning {data.scan.station || "all stations"}: {data.scan.processed}{data.scan.total ? ` / ${data.scan.total}` : " · finding monthly tables"}. Results appear as each station finishes.
      {:else if data.scan.state === "interrupted"}Scan interrupted. Last update {time(data.scan.updated_at)}. Request another scan when ready.
      {:else}Scan finished {time(data.scan.finished_at)}. No further scan runs unless requested.{/if}
    </span>
  </div>
  {#if data.scan?.error}<p class="field-warning">{data.scan.error}</p>{/if}
  {#if currentAction}
    <div class="notice" class:notice-warning={currentAction.state === 'needs_recovery'}>
      <Icon name="shield" /><div><strong>{currentAction.action === 'open' ? 'Opening' : 'Closing'} {currentAction.station} · {currentAction.period}</strong>
      <p>{currentAction.state === 'needs_recovery' ? 'Operation stopped or could not be verified. Resume it to check the saved backup and finish safely.' : currentAction.state === 'queued' ? 'Queued for the FAST worker.' : 'Worker is verifying and updating this station.'}</p>
      {#if currentAction.error}<p class="field-warning">{currentAction.error}</p>{/if}
      {#if currentAction.state === 'needs_recovery'}<button class="button button-secondary" disabled={actionBusy} on:click={() => resumeAction(currentAction)}>Resume and verify</button>{/if}
      </div>
    </div>
  {/if}
  <section class="panel fast-stations">
    <div class="panel-heading"><div><h2>{periodLabel} <span class="count-badge">{visible.length} stations</span></h2><p>Scan a station to verify its current files. Opening deletes existing period records; closing recalls them.</p></div></div>
    {#if visible.length}<div class="fast-card-grid">
      {#each visible as station (station.station)}
        <article class="fast-station-card">
          <div class="fast-card-head"><strong>{station.station}</strong><span class={`status-pill ${station.status === 'closed_records_present' ? 'pill-success' : station.status === 'missing' && station.generation_excluded ? 'pill-neutral' : 'pill-warning'}`}>{labels[station.status]}</span></div>
          <div class="fast-card-counts"><span>Active <strong>{station.active ?? '—'}</strong></span><span>Deleted <strong>{station.deleted ?? '—'}</strong></span></div>
          <p class="fast-card-time">Verified {time(station.successful_at)}</p>
          {#if station.status === 'unverified' && station.cached_status}<small>Previous: {labels[station.cached_status]}</small>{/if}
          {#if station.generation_excluded}<small>Excluded from generation</small>{/if}
          {#if station.error}<small class="field-warning">{station.error}</small>{/if}
          {#if station.other_days}<small class="field-warning">{station.other_days} unexpected dates</small>{/if}
          <div class="fast-card-actions">
            <button class="button button-secondary" on:click={() => requestScan(station.station)} disabled={requestBusy || loading || scanActive || actionActive} aria-label={`Scan ${station.station}`}><Icon name="refresh" />Scan</button>
            {#if !data.read_only && station.status !== 'unverified' && station.active + station.deleted > 0 && !station.other_days}
              {#if station.active > 0}<button class="button button-secondary" disabled={scanActive || actionActive} on:click={() => confirmAction(station.station, 'open')}>Open</button>{/if}
              {#if station.deleted > 0}<button class="button button-secondary" disabled={scanActive || actionActive} on:click={() => confirmAction(station.station, 'close')}>Close</button>{/if}
            {/if}
          </div>
        </article>
      {/each}
    </div>{:else}<div class="empty-state"><h3>{stations.length ? 'No matching stations' : 'No saved station observations'}</h3><p>{stations.length ? 'Try another station name or status.' : 'Choose Scan all stations to discover stations.'}</p></div>{/if}
    <div class="panel-footnote"><Icon name="clock" />Refresh view and period changes read saved results only. FAST files are accessed only when you request a scan or period operation.</div>
  </section>
  {#if data.actions?.length}<section class="panel fast-action-history"><div class="panel-heading"><h2>Recent period operations</h2></div><div class="fast-history-list">
    {#each data.actions.slice(0, 8) as job}<div><strong>{job.station}</strong> · {job.period} · {job.action} <span class="status-pill" class:pill-success={job.state === 'completed'} class:pill-warning={job.state !== 'completed'}>{job.state.replaceAll('_', ' ')}</span><small> by {job.actor} · {time(job.updated_at)}{job.state === 'completed' ? ` · ${job.changed} of ${job.records} records changed` : ''}</small>{#if job.error}<small class="field-warning">{job.error}</small>{/if}</div>{/each}
  </div></section>{/if}
{:else if !error}<p class="refresh-note" role="status">Loading FAST period observations…</p>{/if}
<dialog bind:this={scanDialog} on:close={() => { scanDismissed = scanActive; }} aria-labelledby="fast-scan-title">
  <div class="dialog-content fast-progress-dialog">
    <span class="dialog-icon"><Icon name="refresh" /></span>
    <h2 id="fast-scan-title">{scanActive ? 'Scanning stations' : data?.scan?.state === 'completed' ? 'Station scan finished' : 'Station scan stopped'}</h2>
    <p>{data?.scan?.station || 'All stations'} · {data?.scan?.state === 'queued' ? 'Waiting for the worker' : `${data?.scan?.processed || 0} of ${data?.scan?.total || 0} stations checked`}</p>
    <progress max={data?.scan?.total || 1} value={data?.scan?.processed || 0} aria-label="Station scan progress"></progress>
    <p>{data?.scan?.total ? `${Math.round(100 * (data?.scan?.processed || 0) / data.scan.total)}% complete` : 'Finding station tables…'}{data?.scan?.failed ? ` · ${data.scan.failed} station${data.scan.failed === 1 ? '' : 's'} could not be read` : ''}</p>
    {#if data?.scan?.error}<p class="field-warning">{data.scan.error}</p>{/if}
    {#if data?.scan?.stalled}<p class="field-warning">The worker has stopped reporting progress. Last update {time(data.scan.updated_at)}.</p>{/if}
    <div class="dialog-actions"><button class="button button-secondary" on:click={() => scanDialog.close()}>{scanActive ? 'View stations' : 'Done'}</button></div>
  </div>
</dialog>
<dialog bind:this={actionDialog} on:close={() => target = null} aria-labelledby="fast-action-title">
  <div class="dialog-content"><span class="dialog-icon"><Icon name="lock" /></span>
    <h2 id="fast-action-title">{target?.action === 'open' ? 'Open' : 'Close'} this period?</h2>
    <p>{target?.action === 'open' ? 'Mark existing records as deleted for' : 'Recall existing deleted records for'} <strong>{target?.station}</strong>, <strong>{periodLabel}</strong>. This is a manual operation for one station and one month.</p>
    <div class="dialog-actions"><button class="button button-secondary" disabled={actionBusy} on:click={() => actionDialog.close()}>Cancel</button><button class="button button-primary" disabled={actionBusy} on:click={submitAction}>{actionBusy ? 'Requesting…' : target?.action === 'open' ? 'Open period' : 'Close period'}</button></div>
  </div>
</dialog>
