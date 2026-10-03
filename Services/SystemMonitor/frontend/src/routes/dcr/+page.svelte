<script>
  import { onMount, tick } from "svelte";
  import { base } from "$app/paths";
  import { auth, api, notice, months, time } from "$lib/state";
  import Icon from "$lib/Icon.svelte";
  let data;
  let error = "";
  let dialog;
  let target;
  let busy = false;
  let refreshing = false;
  let stopped = false;
  let timer;
  $: attention = data
    ? data.active.filter((s) => s.state === "error").length +
      data.untracked.length
    : 0;
  $: healthy = data
    ? data.health.filter((h) => !h.stale && !h.error).length
    : 0;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const result = await api("/status");
      if (!stopped) {
        data = result;
        error = "";
      }
    } catch (e) {
      if (!stopped) error = e.message;
    } finally {
      refreshing = false;
    }
  }
  onMount(() => {
    stopped = false;
    async function poll() {
      if (!target && !busy) await refresh();
      if (!stopped) timer = setTimeout(poll, (data?.interval || 30) * 1000);
    }
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  });
  async function confirmClose(schedule) {
    target = schedule;
    await tick();
    dialog.showModal();
  }
  async function closeNow() {
    busy = true;
    try {
      const result = await api(`/close/${target.id}`, {});
      notice(result.message);
      await refresh();
    } catch (e) {
      notice(e.message, "error");
    } finally {
      busy = false;
      dialog.close();
      target = null;
    }
  }
</script>

<svelte:head><title>DCR access · System Monitor</title></svelte:head>
<div class="page-heading">
  <div>
    <p class="eyebrow">DCR SYSTEM · ACCESS MANAGEMENT</p>
    <h1>DCR access</h1>
    <p class="page-description">
      Monitor temporary openings and keep month access on schedule.
    </p>
  </div>
  <a class="button button-primary" href={`${base}/open`}
    ><Icon name="plus" />Open months</a
  >
</div>
{#if !$auth.writes}<div class="notice notice-warning">
    <Icon name="lock" />
    <div>
      <strong>Monitoring only</strong>
      <p>Opening and automatic closure are disabled in read-only mode.</p>
    </div>
  </div>{/if}
{#if error}<div class="notice notice-warning" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Refresh unavailable</strong>
      <p>{error} Displayed data may be out of date.</p>
    </div>
    <button class="button button-secondary" on:click={refresh}>Retry</button>
  </div>{/if}
{#if data}
  <section id="status">
    <div class="metrics">
      <div class="metric">
        <span class="metric-icon"><Icon name="calendar" /></span>
        <div>
          <span class="metric-label">Tracked months</span><strong
            >{data.active.length}</strong
          ><small>Temporary access &amp; scheduled updates</small>
        </div>
      </div>
      <div class="metric">
        <span class:tone-amber={attention > 0} class="metric-icon"
          ><Icon name="alert" /></span
        >
        <div>
          <span class="metric-label">Needs attention</span><strong
            >{attention}</strong
          ><small
            >{attention
              ? "Review the entries below"
              : "No access issues to review"}</small
          >
        </div>
      </div>
      <div class="metric">
        <span class="metric-icon tone-green"><Icon name="grid" /></span>
        <div>
          <span class="metric-label">Applications refreshed</span><strong
            >{healthy}<span class="metric-total">
              / {data.health.length}</span
            ></strong
          ><small
            >{data.unhealthy
              ? "Some applications need a fresh read"
              : "All monitored applications are up to date"}</small
          >
        </div>
      </div>
    </div>
    <div class="refresh-bar" class:refresh-warning={data.unhealthy || !!error}>
      <span class="refresh-message"
        ><span class="status-dot"></span>{data.unhealthy
          ? "Refresh needs attention — some data is stale, unavailable, or failed."
          : "All applications refreshed successfully."}</span
      ><button class="text-action" on:click={refresh} disabled={refreshing}
        ><Icon name="refresh" />Refresh view</button
      >
    </div>
    <div class="panel exceptions-panel">
      <div class="panel-heading">
        <div>
          <h2>
            Access exceptions <span class="count-badge"
              >{data.active.length + data.untracked.length}</span
            >
          </h2>
          <p>Temporary openings and unexpected access</p>
        </div>
        <span class="live-label"
          ><span class="status-dot"></span>Refreshes every {data.interval}s</span
        >
      </div>
      <div class="table-wrap">
        <table>
          <caption class="sr-only"
            >Temporary openings and unexpected access</caption
          ><thead
            ><tr
              ><th>Application</th><th>Month</th><th
                >Scheduled close <small>Manila time</small></th
              ><th>Status &amp; action</th></tr
            ></thead
          ><tbody>
            {#each data.active as s (s.id)}<tr
                ><td
                  ><strong class="app-name">{s.app}</strong><small
                    >{{
                      detected: "(Direct DCR Change)",
                      empty_repair: "Previous-month blank ALLOW",
                      dashboard: "Dashboard schedule",
                    }[s.source] || s.source}</small
                  >{#if s.source === "detected"}<details class="row-details">
                      <summary>Detection details</summary>
                      <p>
                        First detected {time(s.created_at)}. Direct DCR Change
                        detected at this time.
                      </p>
                    </details>{/if}</td
                ><td
                  ><strong>{months[s.month]}</strong><small>{s.year}</small></td
                ><td class="deadline">{time(s.closes_at)}</td><td
                  ><div class="status-actions">
                    <span
                      class={`status-pill ${s.state === "error" || s.stale ? "pill-warning" : s.state === "pending" ? "pill-neutral" : "pill-success"}`}
                      ><span class="status-dot"></span>{s.state === "error"
                        ? "Needs attention"
                        : s.source === "empty_repair"
                          ? "Update pending"
                          : s.state === "pending"
                            ? "Opening pending"
                            : "Open"}</span
                    >{#if $auth.writes}<button
                        class="button button-close"
                        on:click={() => confirmClose(s)}
                        ><Icon name="lock" />Close now</button
                      >{/if}
                  </div>
                  {#if s.stale || error}<small class="field-warning"
                      >Current access unverified — refresh failed or stale</small
                    >{/if}{#if s.error}<small class="field-warning"
                      >{s.error}</small
                    >{/if}</td
                ></tr
              >{/each}
            {#each data.untracked as s}<tr
                ><td
                  ><strong class="app-name">{s.app}</strong><small
                    >(Direct DCR Change)</small
                  ></td
                ><td
                  ><strong>{months[s.month]}</strong><small>{s.year}</small></td
                ><td class="muted">Not scheduled</td><td
                  ><span class="status-pill pill-warning"
                    ><Icon name="alert" />Review required</span
                  ><small class="field-warning"
                    >Unverified or ambiguous record; review required.</small
                  ></td
                ></tr
              >{/each}
            {#if !data.active.length && !data.untracked.length}<tr
                ><td colspan="4" class="empty-state"
                  ><span class="empty-icon"><Icon name="shield" /></span>
                  <h3>Everything is in order</h3>
                  <p>No access exceptions in the latest observations.</p>
                  <span>Use Open months when you need temporary access.</span
                  ></td
                ></tr
              >{/if}
          </tbody>
        </table>
      </div>
      <div class="panel-footnote">
        <Icon name="clock" />Current-month access and previous-month access
        through the 3rd are normal. Closed entries leave this list; history is
        retained.
      </div>
    </div>
    <details class="panel health-panel" open={data.unhealthy}>
      <summary
        ><span
          ><Icon name="grid" />Refresh health
          <span class="count-badge">{data.health.length} applications</span
          ></span
        ><span class="health-summary"
          >{data.unhealthy ? "Review needed" : "All DCR applications healthy"}<span
            class="chevron"
          ></span></span
        ></summary
      >
      <div class="health-grid">
        {#each data.health as h}<div class="health-item">
            <div>
              <strong>{h.app}</strong><span
                class={`status-pill ${h.error || h.stale ? "pill-warning" : "pill-success"}`}
                >{h.error || h.stale ? "Needs attention" : "Healthy"}</span
              >
            </div>
            <small>Last successful read</small><time
              >{time(h.successful_at)}</time
            >{#if h.error}<p class="field-warning">
                {h.error}
              </p>{:else if h.stale}<p class="field-warning">
                Awaiting a fresh worker observation
              </p>{/if}
          </div>{/each}
      </div>
    </details>
    <p class="refresh-note">
      <Icon name="clock" />Read timestamps show the latest worker observation,
      even if refresh stops.
    </p>
  </section>
{:else if !error}<p class="refresh-note" role="status">
    Loading access overview…
  </p>{/if}
<dialog
  bind:this={dialog}
  on:close={() => (target = null)}
  on:cancel={(event) => {
    if (busy) event.preventDefault();
  }}
  aria-labelledby="close-title"
  aria-describedby="close-description"
>
  <div class="dialog-content">
    <span class="dialog-icon"><Icon name="lock" /></span>
    <h2 id="close-title">Close month access?</h2>
    <p id="close-description">
      Access to <strong
        >{target ? `${months[target.month]} ${target.year}` : ""}</strong
      >
      in <strong>{target?.app || ""}</strong> will close immediately. You can open
      it again from Open months.
    </p>
    <div class="dialog-actions">
      <button
        class="button button-secondary"
        disabled={busy}
        on:click={() => dialog.close()}>Keep open</button
      ><button class="button button-danger" disabled={busy} on:click={closeNow}
        ><Icon name="lock" />{busy ? "Closing month…" : "Close now"}</button
      >
    </div>
  </div>
</dialog>
