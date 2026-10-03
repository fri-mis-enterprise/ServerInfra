<script>
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import { goto } from "$app/navigation";
  import { api, notice, months, time } from "$lib/state";
  import Icon from "$lib/Icon.svelte";
  let options;
  let app = "";
  let year;
  let selected = [];
  let closes = "";
  let error = "";
  let busy = false;
  async function load() {
    try {
      options = await api("/open-options");
      app = options.apps[0];
      year = options.year;
      closes = options.close_default;
      error = "";
    } catch (e) {
      error = e.message;
    }
  }
  onMount(() => {
    load();
  });
  async function submit() {
    if (!selected.length) {
      error = "Select at least one month to continue.";
      return;
    }
    busy = true;
    error = "";
    try {
      const result = await api("/open", {
        app,
        year,
        months: selected,
        close_at: closes,
        request_id: options.request_id,
      });
      result.messages.forEach((item) => notice(item.text, item.kind));
      await goto(`${base}/`);
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Open months · DCR Access</title></svelte:head>
<a class="back-link" href={`${base}/`}><Icon name="back" />Back to dashboard</a>
<div class="page-heading">
  <div>
    <p class="eyebrow">TEMPORARY ACCESS</p>
    <h1>Open months</h1>
    <p class="page-description">
      Choose the months you need and set when access should close.
    </p>
  </div>
  <span class="status-pill pill-neutral"
    ><Icon name="calendar" />Scheduled access</span
  >
</div>
{#if error}<div class="notice notice-error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Action needs attention</strong>
      <p>{error}</p>
    </div>
    {#if !options}<button class="button button-secondary" on:click={load}
        >Retry</button
      >{/if}
  </div>{/if}
{#if options}
  {#if !options.writes}<div class="notice notice-warning">
      <Icon name="lock" />
      <div>
        <strong>Read-only mode</strong>
        <p>Opening is disabled while the service is in read-only mode.</p>
      </div>
    </div>{/if}
  <div class="form-layout">
    <form
      class="panel open-form"
      id="open-form"
      on:submit|preventDefault={submit}
    >
      <fieldset disabled={!options.writes || busy}>
        <div class="form-section">
          <div class="section-heading">
            <span class="step-number">01</span>
            <div>
              <h2>Select an application</h2>
              <p>Choose the application and calendar year.</p>
            </div>
          </div>
          <div class="input-grid">
            <label for="app"
              >Application<select id="app" bind:value={app} required
                >{#each options.apps as name}<option value={name}>{name}</option
                  >{/each}</select
              ></label
            ><label for="year"
              >Year<input
                type="number"
                id="year"
                min="1900"
                max="2100"
                bind:value={year}
                required
              /></label
            >
          </div>
        </div>
        <div class="form-section">
          <div class="section-heading">
            <span class="step-number">02</span>
            <div>
              <h2>Select months</h2>
              <p>Choose one or more months. Only checked months change.</p>
            </div>
          </div>
          <fieldset class="month-fieldset">
            <legend class="sr-only">Months</legend>
            <div class="months">
              {#each months.slice(1) as month, index}<label class="month-choice"
                  ><input
                    type="checkbox"
                    value={index + 1}
                    bind:group={selected}
                  /><span>{month}</span></label
                >{/each}
            </div>
            <p class="selection-count">
              {selected.length
                ? `${selected.length} month${selected.length === 1 ? "" : "s"} selected`
                : "No months selected"}
            </p>
          </fieldset>
        </div>
        <div class="form-section">
          <div class="section-heading">
            <span class="step-number">03</span>
            <div>
              <h2>Set the closing time</h2>
              <p>Access closes automatically at your chosen date and time.</p>
            </div>
          </div>
          <label for="close-at"
            >Close date and time (Asia/Manila)<input
              type="datetime-local"
              id="close-at"
              min={options.close_min}
              max={options.close_max}
              bind:value={closes}
              required
            /></label
          >
          <p class="input-help">
            Choose an exact time up to 90 days ahead. All deadlines follow the
            system clock shown above.
          </p>
        </div>
        <div class="form-actions">
          <a class="button button-secondary" href={`${base}/`}>Cancel</a><button
            class="button button-primary"
            type="submit"
            ><Icon name="plus" />{busy
              ? "Opening months…"
              : "Open selected months"}</button
          >
        </div>
      </fieldset>
    </form>
    <aside class="form-aside">
      <div class="panel summary-panel">
        <span class="aside-icon"><Icon name="calendar" /></span>
        <h2>Opening summary</h2>
        <dl class="opening-summary">
          <div>
            <dt>Application</dt>
            <dd>{app}</dd>
          </div>
          <div>
            <dt>Year</dt>
            <dd>{year}</dd>
          </div>
          <div>
            <dt>Selected months</dt>
            <dd>
              {selected.length
                ? selected
                    .slice()
                    .sort((a, b) => a - b)
                    .map((m) => months[m])
                    .join(", ")
                : "Choose your months"}
            </dd>
          </div>
          <div>
            <dt>Closes · Manila time</dt>
            <dd>
              {closes ? time(`${closes}:00+08:00`) : "Choose a closing time"}
            </dd>
          </div>
        </dl>
        <p class="aside-note">
          <Icon name="shield" />A new close time replaces the existing deadline
          for each selected month.
        </p>
      </div>
      <div class="aside-help">
        <h3>Access stays on schedule</h3>
        <p>
          The selected months open immediately and close automatically at the
          deadline. You can also close them early from the dashboard.
        </p>
      </div>
    </aside>
  </div>
{:else if !error}<p class="refresh-note" role="status">
    Loading opening options…
  </p>{/if}
