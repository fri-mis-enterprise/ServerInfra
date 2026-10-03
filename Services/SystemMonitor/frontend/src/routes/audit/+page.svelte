<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { base } from "$app/paths";
  import { goto } from "$app/navigation";
  import { api, months, time } from "$lib/state";
  import Icon from "$lib/Icon.svelte";
  const labels = {
    open_requested: "Opening requested",
    opened: "Month opened",
    deadline_updated: "Close time updated",
    opening_failed: "Opening unverified",
    opening_observed: "Open access detected after request",
    close_requested: "Close requested",
    manual_closed: "Month closed",
    closure_failed: "Closure unverified",
    auto_closed: "Automatic closure",
    closure_observed: "Closure observed",
    blank_filled: "Empty ALLOW filled",
    dcr_open_detected: "Opening detected",
    dcr_access_observed: "Open access first observed",
    dcr_close_detected: "Closure detected",
    replaced: "Schedule replaced",
    excluded: "Monitoring removed",
    active: "Access confirmed",
    closed: "Closed",
    error: "Needs attention",
    pending: "Update pending",
  };
  const sources = {
    dashboard: "Dashboard",
    dcr: "Direct DCR Change",
    system: "Automatic update",
  };
  let data;
  let app = "";
  let origin = "";
  let month = "";
  let error = "";
  let loading = false;
  let mounted = false;
  let sequence = 0;
  $: query = $page.url.search;
  $: if (mounted) load(query);
  onMount(() => {
    mounted = true;
    return () => {
      mounted = false;
      sequence++;
    };
  });
  async function load(search) {
    const current = ++sequence;
    const params = new URLSearchParams(search);
    app = params.get("app") || "";
    origin = params.get("origin") || "";
    month = params.get("month") || "";
    loading = true;
    error = "";
    try {
      const result = await api(`/audit${search}`);
      if (current === sequence) data = result;
    } catch (e) {
      if (current === sequence) error = e.message;
    } finally {
      if (current === sequence) loading = false;
    }
  }
  function filters() {
    const params = new URLSearchParams();
    if (app) params.set("app", app);
    if (origin) params.set("origin", origin);
    if (month) params.set("month", month);
    return params;
  }
  function apply() {
    goto(`${base}/audit?${filters()}`);
  }
  function pageLink(number) {
    const params = new URLSearchParams(query);
    params.set("page", String(number));
    return `${base}/audit?${params}`;
  }
  function action(e) {
    return e.action === "scheduled"
      ? e.source === "detected"
        ? "Direct DCR Change detected"
        : "Close scheduled"
      : labels[e.action] || e.action.replaceAll("_", " ");
  }
  function detection(e) {
    return (
      e.action.startsWith("dcr_") ||
      e.action === "opening_observed" ||
      (e.action === "scheduled" && e.source === "detected")
    );
  }
</script>

<svelte:head><title>Audit trail · DCR Access</title></svelte:head>
<div class="page-heading">
  <div>
    <p class="eyebrow">ACCESS HISTORY</p>
    <h1>Audit trail</h1>
    <p class="page-description">
      Dashboard actions, direct DCR changes, and automatic closures.
    </p>
  </div>
  <button
    class="button button-secondary"
    disabled={loading}
    on:click={() => load(query)}><Icon name="refresh" />Refresh history</button
  >
</div>
<form class="panel audit-filters" on:submit|preventDefault={apply}>
  <label for="audit-app"
    >Application<select id="audit-app" bind:value={app}
      ><option value="">All applications</option
      >{#each data?.apps || [] as name}<option value={name}>{name}</option
        >{/each}</select
    ></label
  ><label for="audit-origin"
    >Source<select id="audit-origin" bind:value={origin}
      ><option value="">All sources</option><option value="dashboard"
        >Dashboard</option
      ><option value="dcr">Direct DCR Change</option><option value="system"
        >System</option
      ></select
    ></label
  ><label for="audit-month"
    >Record month<input
      type="month"
      id="audit-month"
      bind:value={month}
    /></label
  >
  <div class="filter-actions">
    <button class="button button-primary" type="submit">Apply filters</button><a
      class="text-action"
      href={`${base}/audit`}>Clear</a
    >
  </div>
</form>
{#if error}<div class="notice notice-error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>History unavailable</strong>
      <p>{error}</p>
    </div>
  </div>{/if}
{#if data}<div class="panel audit-panel" aria-busy={loading}>
    <div class="panel-heading">
      <div>
        <h2>
          Recorded activity <span class="count-badge">{data.total} events</span>
        </h2>
        <p>All timestamps are shown in Manila time, including seconds.</p>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <caption class="sr-only">Month access audit trail</caption><thead
          ><tr
            ><th>Time · Manila</th><th>Application / month</th><th>Action</th
            ><th>User / source</th><th>Details</th></tr
          ></thead
        ><tbody>
          {#each data.entries as e (e.id)}<tr
              ><td class="audit-timestamp"
                >{time(e.at, true)}<small
                  >{detection(e) ? "Detection time" : "Recorded time"}</small
                ></td
              ><td
                ><strong>{e.app || "System"}</strong>{#if e.month}<small
                    >{months[e.month]} {e.year} · Record {e.recid}</small
                  >{/if}</td
              ><td
                ><span
                  class={`status-pill ${["error", "opening_failed", "closure_failed"].includes(e.action) ? "pill-warning" : ["opened", "manual_closed", "auto_closed"].includes(e.action) ? "pill-success" : "pill-neutral"}`}
                  >{action(e)}</span
                ></td
              ><td
                ><strong
                  >{e.actor ||
                    (e.origin === "dcr"
                      ? "(Direct DCR Change)"
                      : e.origin === "system"
                        ? "System"
                        : "Legacy event")}</strong
                ><small>{sources[e.origin]}</small></td
              ><td class="audit-detail">{e.detail || "—"}</td></tr
            >{:else}<tr
              ><td colspan="5" class="empty-state"
                ><span class="empty-icon"><Icon name="clock" /></span>
                <h3>No activity found</h3>
                <p>
                  {app || origin || month
                    ? "Try another application, source, or record month."
                    : "Access changes will appear here as they are recorded."}
                </p></td
              ></tr
            >{/each}
        </tbody>
      </table>
    </div>
    <div class="audit-pagination">
      <span>Page {data.page} of {data.pages} · {data.total} events</span>
      <div>
        {#if data.page > 1}<a
            class="button button-secondary"
            href={pageLink(data.page - 1)}><Icon name="back" />Previous</a
          >{/if}{#if data.page < data.pages}<a
            class="button button-secondary"
            href={pageLink(data.page + 1)}>Next<Icon name="arrow" /></a
          >{/if}
      </div>
    </div>
  </div>{:else if loading}<p class="refresh-note" role="status">
    Loading audit history…
  </p>{/if}
<p class="refresh-note">
  <Icon name="clock" />Direct DCR Change entries show when the monitor detected
  the change. Earlier dashboard events retain their original history.
</p>
