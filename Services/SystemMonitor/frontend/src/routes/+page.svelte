<script>
  import { base } from "$app/paths";
  import { auth } from "$lib/state";
  import Icon from "$lib/Icon.svelte";
</script>

<svelte:head><title>Systems · System Monitor</title></svelte:head>
<div class="page-heading">
  <div>
    <p class="eyebrow">INTERNAL OPERATIONS</p>
    <h1>Systems overview</h1>
    <p class="page-description">
      Choose a system to monitor its operations and manage available controls.
    </p>
  </div>
</div>

<div class="systems-grid">
  <section class="panel system-card" aria-labelledby="dcr-title">
    <div class="system-card-top">
      <span class="system-symbol"><Icon name="shield" /></span>
      <span class="status-pill pill-success">Available</span>
    </div>
    <p class="eyebrow">MONTH ACCESS</p>
    <h2 id="dcr-title">DCR System</h2>
    <p class="system-description">
      Monitor temporary month access, scheduled closures, and changes across
      DCR applications.
    </p>
    <div class="system-capabilities">
      <span><Icon name="calendar" />Temporary access and deadlines</span>
      <span><Icon name="clock" />Access history and audit trail</span>
    </div>
    <div class="system-card-footer">
      <span class="system-mode">
        <Icon name={$auth.writes ? "check" : "lock"} />
        {$auth.writes ? "Access controls enabled" : "Monitoring only"}
      </span>
      <a class="button button-primary" href={`${base}/dcr`}>
        Open DCR<Icon name="arrow" />
      </a>
    </div>
  </section>

  <section class="panel system-card" aria-labelledby="fast-title">
    <div class="system-card-top">
      <span class="system-symbol"><Icon name="calendar" /></span>
      <span class={`status-pill ${$auth.fast_writes ? 'pill-success' : 'pill-neutral'}`}>{$auth.fast_writes ? 'Controls enabled' : 'Monitoring only'}</span>
    </div>
    <p class="eyebrow">MONTHLY PERIODS</p>
    <h2 id="fast-title">FAST System</h2>
    <p class="system-description">
      Review monthly closing records and period status across FAST stations.
    </p>
    <div class="system-capabilities">
      <span><Icon name="grid" />Station period monitoring</span>
      <span><Icon name="refresh" />Active and deleted period records</span>
      {#if $auth.fast_writes}<span><Icon name="lock" />Manual period opening and closing</span>{/if}
    </div>
    <div class="system-card-footer">
      <span class="system-mode"><Icon name={$auth.fast_writes ? 'check' : 'lock'} />{$auth.fast_writes ? 'Period controls enabled' : 'Period monitoring only'}</span>
      <a class="button button-primary" href={`${base}/fast`}>Open FAST<Icon name="arrow" /></a>
    </div>
  </section>
</div>

<div class="panel workspace-note">
  <Icon name="shield" />
  <p>Your account is shared across this workspace. Each system has its own operations and controls.</p>
</div>
