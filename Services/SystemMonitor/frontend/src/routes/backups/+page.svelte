<script>
  import { onMount } from "svelte";
  import { api, notice, time } from "$lib/state";
  import Icon from "$lib/Icon.svelte";
  import SchedulePicker from "$lib/SchedulePicker.svelte";
  import { formatScheduleHuman, jobLabel } from "$lib/schedule";

  const tabs = [
    { id: "targets", label: "Targets" },
    { id: "logs", label: "Logs & Failures" },
    { id: "settings", label: "Settings & Tools" },
  ];
  const jobOrder = ["fast", "system3", "sql", "ibs"];

  let data;
  let preflight = null;
  let error = "";
  let loading = false;
  let busy = "";
  let tab = "targets";
  let selected = "";
  let stopped = false;
  let timer;

  let targetDialog;
  let scheduleDialog;
  let logDialog;
  let preflightDialog;
  let confirmDialog;

  let form = blankForm();
  let formError = "";
  let formBusy = false;
  let formCheck = null;
  let formCheckBusy = false;
  let showPassword = false;

  let scheduleTarget = null;
  let scheduleValue = "";
  let scheduleError = "";
  let scheduleBusy = false;
  let scheduleCheck = null;
  let scheduleCheckBusy = false;

  let confirm = null;
  let confirmBusy = false;

  let logMode = "file";
  let logTitle = "";
  let logPath = "";
  let logUnit = "";
  let logText = "";
  let logError = "";
  let logBusy = false;
  let logTimer;

  let preflightBusy = false;
  let preflightError = "";

  let logFiles = [];
  let logsText = "";
  let logsError = "";
  let logsBusy = false;
  let logSelection = "failures";

  let configs = [];
  let configId = "backup";
  let configContent = "";
  let configsError = "";
  let configsBusy = false;

  $: targets = data?.targets || [];
  $: current = targets.find((target) => target.name === selected) || null;
  $: runningJobs = targets.reduce((sum, target) => sum + (target.jobs || []).filter((job) => job.is_running).length, 0);
  $: healthy = targets.filter((target) => target.status === "OK").length;
  $: attention = targets.filter((target) => ["FAIL", "STALE", "PARTIAL"].includes(target.status)).length;
  $: mounts = data?.health?.mounts || [];
  $: activity = data?.activity || [];
  $: currentConfig = configs.find((config) => config.id === configId) || null;
  $: if (targets.length && !targets.some((target) => target.name === selected)) selected = targets[0].name;

  function blankForm() {
    return {
      editing: false,
      name: "",
      dest_ip: "",
      username: "",
      password: "",
      domain: "",
      schedule: "Mon..Sat 08:00:00",
      enabled: true,
      keep_cred: false,
    };
  }
  function statusPill(status) {
    if (status === "OK") return "pill-success";
    if (status === "RUNNING") return "pill-info";
    if (["FAIL", "STALE", "PARTIAL"].includes(status)) return "pill-warning";
    return "pill-neutral";
  }
  function statusIcon(status) {
    if (status === "OK") return "check";
    if (status === "RUNNING") return "play";
    if (["FAIL", "STALE", "PARTIAL"].includes(status)) return "alert";
    return "clock";
  }
  function formatRunTime(value) {
    if (!value || value === "-") return "Never";
    const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T") + "+08:00");
    if (Number.isNaN(parsed.getTime())) return value;
    return time(parsed.toISOString());
  }
  function timerEnabled(target) {
    return target.timer?.enabled === "enabled";
  }
  function jobsOf(target) {
    return (target.jobs || []).slice().sort((left, right) => jobOrder.indexOf(left.job) - jobOrder.indexOf(right.job));
  }
  function unitFor(job) {
    if (job.active_unit) return job.active_unit;
    if (job.target === "ibs") return "ibs-backup.service";
    return `backup-job@${job.key}.service`;
  }
  function selectTarget(name) {
    selected = name;
  }
  function tileKey(event, name) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectTarget(name);
    }
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const result = await api("/backups/status");
      if (!stopped) {
        data = result;
        error = "";
      }
    } catch (e) {
      if (!stopped) error = e.message;
    } finally {
      loading = false;
      clearTimeout(timer);
      if (!stopped) {
        const live = data?.targets?.some((target) => target.is_running || (target.jobs || []).some((job) => job.is_running));
        timer = setTimeout(refresh, live ? 2500 : 15000);
      }
    }
  }

  function switchTab(id) {
    tab = id;
    if (id === "logs") loadLogs(logSelection);
    if (id === "settings") loadConfigs();
  }

  async function loadLogs(selection = logSelection) {
    logSelection = selection;
    logsBusy = true;
    try {
      const query = selection === "journal"
        ? "source=journal"
        : selection === "failures"
          ? "source=failures"
          : `source=file&path=${encodeURIComponent(selection)}`;
      const result = await api(`/backups/logs?${query}`);
      logFiles = result.files || [];
      logsText = result.content || "";
      logsError = "";
    } catch (e) {
      logsError = e.message;
    } finally {
      logsBusy = false;
    }
  }

  async function loadConfigs() {
    if (configsBusy) return;
    configsBusy = true;
    try {
      const result = await api("/backups/configs");
      configs = result.configs || [];
      configsError = "";
      const found = configs.find((config) => config.id === configId) || configs[0];
      if (found) {
        configId = found.id;
        configContent = found.content || "";
      }
    } catch (e) {
      configsError = e.message;
    } finally {
      configsBusy = false;
    }
  }
  function chooseConfig() {
    const found = configs.find((config) => config.id === configId);
    configContent = found?.content || "";
  }
  async function saveConfig() {
    if (configsBusy) return;
    configsBusy = true;
    configsError = "";
    try {
      const result = await api("/backups/configs/save", { id: configId, content: configContent });
      configs = configs.map((c) => (c.id === configId ? { ...c, content: configContent } : c));
      notice(result.message);
    } catch (e) {
      configsError = e.message;
    } finally {
      configsBusy = false;
    }
  }

  function openRegister() {
    form = blankForm();
    formError = "";
    formCheck = null;
    showPassword = false;
    if (!targetDialog.open) targetDialog.showModal();
  }
  function openEdit(target) {
    form = {
      editing: true,
      name: target.name,
      dest_ip: target.dest_ip || "",
      username: target.cred_username || "",
      password: "",
      domain: "",
      schedule: target.timer?.on_calendar || "Mon..Sat 08:00:00",
      enabled: timerEnabled(target),
      keep_cred: true,
    };
    formError = "";
    formCheck = null;
    showPassword = false;
    if (!targetDialog.open) targetDialog.showModal();
  }
  async function validateFormSchedule() {
    if (formCheckBusy) return;
    formCheckBusy = true;
    formError = "";
    try {
      formCheck = await api("/backups/validate-calendar", { schedule: form.schedule });
    } catch (e) {
      formCheck = null;
      formError = e.message;
    } finally {
      formCheckBusy = false;
    }
  }
  async function saveTarget() {
    if (formBusy) return;
    formBusy = true;
    formError = "";
    try {
      const result = await api("/backups/targets/register", {
        name: form.name.trim().toLowerCase(),
        dest_ip: form.dest_ip.trim(),
        schedule: form.schedule.trim(),
        enabled: form.enabled,
        username: form.username.trim(),
        password: form.password,
        domain: form.domain.trim(),
        keep_cred: form.keep_cred,
      });
      const savedName = form.name.trim().toLowerCase();
      targetDialog.close();
      selected = savedName;
      notice(result.message);
      await refresh();
    } catch (e) {
      formError = e.message;
    } finally {
      formBusy = false;
    }
  }

  function openSchedule(target) {
    scheduleTarget = target;
    scheduleValue = target.timer?.on_calendar || "";
    scheduleError = "";
    scheduleCheck = null;
    if (!scheduleDialog.open) scheduleDialog.showModal();
  }
  async function validateTimerSchedule() {
    if (scheduleCheckBusy) return;
    scheduleCheckBusy = true;
    scheduleError = "";
    try {
      scheduleCheck = await api("/backups/validate-calendar", { schedule: scheduleValue });
    } catch (e) {
      scheduleCheck = null;
      scheduleError = e.message;
    } finally {
      scheduleCheckBusy = false;
    }
  }
  async function saveSchedule() {
    if (!scheduleTarget?.timer || scheduleBusy) return;
    scheduleBusy = true;
    scheduleError = "";
    try {
      const result = await api("/backups/timers/schedule", {
        timer: scheduleTarget.timer.unit,
        schedule: scheduleValue.trim(),
      });
      scheduleDialog.close();
      notice(result.message);
      await refresh();
    } catch (e) {
      scheduleError = e.message;
    } finally {
      scheduleBusy = false;
    }
  }
  async function toggleTimer(target) {
    if (!target.timer || busy) return;
    busy = "timer";
    try {
      const result = await api("/backups/timers/toggle", {
        timer: target.timer.unit,
        enabled: !timerEnabled(target),
      });
      notice(result.message);
      await refresh();
    } catch (e) {
      notice(e.message, "error");
    } finally {
      busy = "";
    }
  }

  async function runScope(scope, extra) {
    if (busy) return;
    busy = scope;
    try {
      const result = await api("/backups/run", { scope, ...extra });
      notice(result.message);
      await refresh();
    } catch (e) {
      notice(e.message, "error");
    } finally {
      busy = "";
    }
  }
  function runJob(job) {
    return runScope("job", { key: job.key });
  }
  function runTarget(target) {
    return runScope("target", { target: target.name });
  }
  function askRunAll() {
    ask({
      title: "Run all backups?",
      message: "Queue every enabled backup target and include the IBS database job.",
      label: "Run all backups",
      run: () => runScope("all", { include_ibs: true }),
    });
  }
  function askStop(job) {
    ask({
      title: `Stop ${jobLabel(job.job)} (${job.target})?`,
      message: `Stop ${unitFor(job)}. Any incomplete .part archive will be cleaned up automatically.`,
      label: "Stop unit",
      danger: true,
      run: async () => {
        const result = await api("/backups/stop", { unit: unitFor(job) });
        notice(result.message);
        await refresh();
      },
    });
  }
  function askDelete(target) {
    ask({
      title: `Delete ${target.name}?`,
      message: `Remove the target configuration and credential for ${target.name}. Existing archives are kept.`,
      label: "Delete target",
      danger: true,
      run: async () => {
        const result = await api("/backups/targets/delete", { name: target.name });
        if (selected === target.name) selected = "";
        notice(result.message);
        await refresh();
      },
    });
  }
  function askClearFailures() {
    ask({
      title: "Clear failures.log?",
      message: "Remove all recorded backup failure messages. This cannot be undone.",
      label: "Clear failures.log",
      danger: true,
      run: async () => {
        const result = await api("/backups/tools/clear-failures", {});
        notice(result.message);
        await loadLogs(logSelection);
      },
    });
  }
  function askRebuild() {
    ask({
      title: "Rebuild FAST manifest?",
      message: "Clear the FAST station manifest cache so the next scan rediscovers stations.",
      label: "Rebuild manifest",
      run: async () => {
        const result = await api("/backups/tools/rebuild-manifest", {});
        notice(result.message);
      },
    });
  }
  async function testNotify() {
    if (busy) return;
    busy = "notify";
    try {
      const result = await api("/backups/tools/test-notify", {});
      notice(result.message);
    } catch (e) {
      notice(e.message, "error");
    } finally {
      busy = "";
    }
  }

  function ask(config) {
    confirm = config;
    if (!confirmDialog.open) confirmDialog.showModal();
  }
  async function runConfirm() {
    if (!confirm || confirmBusy) return;
    const action = confirm.run;
    confirmBusy = true;
    try {
      await action();
      confirmDialog.close();
    } catch (e) {
      notice(e.message, "error");
    } finally {
      confirmBusy = false;
    }
  }

  async function openPreflight() {
    if (!preflightDialog.open) preflightDialog.showModal();
    await loadPreflight();
  }
  async function loadPreflight() {
    if (preflightBusy) return;
    preflightBusy = true;
    preflightError = "";
    try {
      preflight = await api("/backups/preflight");
    } catch (e) {
      preflightError = e.message;
    } finally {
      preflightBusy = false;
    }
  }

  function openLog(title, path, unit, mode = "file") {
    logTitle = title;
    logPath = path || "";
    logUnit = unit || "";
    logMode = mode;
    logText = "";
    logError = "";
    if (!logDialog.open) logDialog.showModal();
    loadLog();
    clearInterval(logTimer);
    logTimer = setInterval(loadLog, 2500);
  }
  async function loadLog() {
    if (logBusy) return;
    logBusy = true;
    try {
      const query = logMode === "journal"
        ? `source=journal&unit=${encodeURIComponent(logUnit)}`
        : `source=file&path=${encodeURIComponent(logPath)}`;
      const result = await api(`/backups/logs?${query}`);
      logText = result.content || "";
      logError = "";
    } catch (e) {
      logError = e.message;
    } finally {
      logBusy = false;
    }
  }
  function setLogMode(mode) {
    if (logMode === mode) return;
    logMode = mode;
    loadLog();
  }
  function closeLog() {
    clearInterval(logTimer);
    logTimer = undefined;
  }

  onMount(() => {
    stopped = false;
    refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(logTimer);
    };
  });
</script>

<svelte:head><title>Backups · System Monitor</title></svelte:head>
<div class="page-heading">
  <div>
    <p class="eyebrow">DATA PROTECTION · SYSTEM BACKUPS</p>
    <h1>Backup operations</h1>
    <p class="page-description">Monitor target health, run jobs on demand, and manage schedules, logs, and configuration.</p>
  </div>
  <div class="backup-page-actions">
    {#if data && !data.controls_enabled}<span class="status-pill pill-neutral"><Icon name="lock" />Read-only</span>{/if}
    <button type="button" class="button button-secondary" on:click={refresh} disabled={loading}><Icon name="refresh" />Refresh</button>
    <button type="button" class="button button-secondary" on:click={openPreflight}><Icon name="shield" />Preflight Check</button>
    <button type="button" class="button button-secondary" on:click={askRunAll} disabled={!!busy || !data?.controls_enabled}><Icon name="play" />Run All</button>
    <button type="button" class="button button-primary" on:click={openRegister} disabled={!data?.controls_enabled}><Icon name="plus" />Register Target</button>
  </div>
</div>
{#if data && !data.controls_enabled}<div class="notice notice-warning"><Icon name="lock" /><div><strong>Backup controls are disabled</strong><p>Status, logs, and configuration are available. The administrator must enable backup controls before jobs can run or settings can change.</p></div></div>{/if}
{#if error}<div class="notice notice-error" role="alert"><Icon name="alert" /><div><strong>Backup status unavailable</strong><p>{error} Displayed results may be out of date.</p></div></div>{/if}

{#if data}
  <div class="metrics backup-metrics">
    <div class="metric"><span class="metric-icon tone-green"><Icon name="check" /></span><div><span class="metric-label">Healthy targets</span><strong>{healthy}</strong><small>of {targets.length} target{targets.length === 1 ? "" : "s"}</small></div></div>
    <div class="metric"><span class="metric-icon"><Icon name="play" /></span><div><span class="metric-label">Running jobs</span><strong>{runningJobs}</strong><small>{runningJobs ? "Live status refreshes every 2.5s" : "No jobs running now"}</small></div></div>
    <div class="metric"><span class="metric-icon" class:tone-amber={attention > 0}><Icon name="alert" /></span><div><span class="metric-label">Attention needed</span><strong>{attention}</strong><small>{data.health?.failure_count || 0} recent failure{data.health?.failure_count === 1 ? "" : "s"} recorded</small></div></div>
    <div class="metric"><span class="metric-icon"><Icon name="database" /></span><div><span class="metric-label">Staging free space</span><strong>{data.health?.staging_free || "—"}</strong><small>of {data.health?.staging_total || "—"} · {data.health?.staging_used_pct ?? 0}% used</small></div></div>
  </div>
  <div class="backup-mounts">
    {#each mounts as mount (mount.path)}
      <span class={`status-pill ${mount.is_mount ? "pill-success" : mount.exists ? "pill-warning" : "pill-neutral"}`}><Icon name={mount.is_mount ? "check" : mount.exists ? "alert" : "lock"} />{mount.name}{mount.is_mount ? " mounted" : mount.exists ? " not mounted" : " missing"}</span>
    {/each}
    <span class={`status-pill ${data.health?.pigz_available ? "pill-success" : "pill-neutral"}`}><Icon name="settings" />pigz {data.health?.pigz_available ? "available" : "not installed"}</span>
  </div>
{/if}

<div class="backup-tabs" role="tablist" aria-label="Backup views">
  {#each tabs as item (item.id)}
    <button type="button" class="backup-tab" class:active={tab === item.id} role="tab" aria-selected={tab === item.id} on:click={() => switchTab(item.id)}>{item.label}</button>
  {/each}
</div>

{#if tab === "targets"}
  <section class="panel backup-targets" aria-labelledby="backup-targets-title">
    <div class="panel-heading">
      <div><h2 id="backup-targets-title">Backup targets <span class="count-badge">{targets.length}</span></h2><p>Select a target to inspect its jobs, schedule, and actions.</p></div>
      <span class="live-label"><span class="status-dot"></span>{runningJobs ? "Live" : "Idle"}</span>
    </div>
    {#if targets.length}
      <div class="backup-tile-grid">
        {#each targets as target (target.name)}
          <div class="backup-tile" class:selected={current?.name === target.name} role="button" tabindex="0" aria-pressed={current?.name === target.name} on:click={() => selectTarget(target.name)} on:keydown={(event) => tileKey(event, target.name)}>
            <div class="backup-tile-head">
              <div><strong>{target.name}</strong><span class="backup-tile-dest">{target.dest_ip}</span></div>
              <span class={`status-pill ${statusPill(target.status)}`}><Icon name={statusIcon(target.status)} />{target.status}</span>
            </div>
            {#if target.is_running && target.active_phase}
              <p class="backup-tile-phase"><span class="status-dot"></span>{target.active_phase}</p>
            {:else}
              <p class="backup-tile-phase">{target.cred_configured ? `Credential: ${target.cred_username || "configured"}` : "No credential configured"}</p>
            {/if}
            <div class="backup-chips">
              {#each jobsOf(target) as job (job.key)}
                <span class={`backup-chip ${statusPill(job.status)}`}>{jobLabel(job.job)} · {job.status}</span>
              {/each}
            </div>
            <div class="backup-tile-foot">
              <span>
                <Icon name="clock" />
                {#if target.timer}
                  {formatScheduleHuman(target.timer.on_calendar)}
                  {#if target.timer.enabled !== "enabled"} · paused{:else if target.timer.left && target.timer.left !== "-"} · in {target.timer.left}{/if}
                {:else}
                  No schedule
                {/if}
              </span>
              <button type="button" class="button button-secondary" on:click|stopPropagation={() => runTarget(target)} disabled={!!busy || !data?.controls_enabled} aria-label={`Run ${target.name} backup`}><Icon name="play" />Run</button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-state"><h3>No backup targets</h3><p>Register a target to start monitoring backups.</p></div>
    {/if}
  </section>

  {#if current}
    <section class="panel backup-detail" aria-labelledby="backup-detail-title">
      <div class="panel-heading backup-detail-head">
        <div>
          <h2 id="backup-detail-title">{current.name} <span class="count-badge">{current.kind === "ibs" ? "PostgreSQL" : "SMB target"}</span></h2>
          <p>
            {current.dest_ip}
            {#if current.timer}
              {" · "}{formatScheduleHuman(current.timer.on_calendar)}
              {#if current.timer.enabled !== "enabled"} · Timer paused
              {:else if current.timer.next_run && current.timer.next_run !== "-"} · Next: {formatRunTime(current.timer.next_run)}{current.timer.left && current.timer.left !== "-" ? ` (in ${current.timer.left})` : ""}{/if}
            {:else}
              {" · "}No schedule configured
            {/if}
          </p>
        </div>
        <div class="backup-detail-actions">
          {#if current.timer}
            <button type="button" class="button button-secondary" on:click={() => toggleTimer(current)} disabled={!!busy || !data?.controls_enabled}><Icon name={timerEnabled(current) ? "stop" : "play"} />{timerEnabled(current) ? "Disable timer" : "Enable timer"}</button>
            <button type="button" class="button button-secondary" on:click={() => openSchedule(current)} disabled={!!busy || !data?.controls_enabled}><Icon name="calendar" />Edit Schedule</button>
          {/if}
          {#if current.kind === "cifs"}
            <button type="button" class="button button-secondary" on:click={() => openEdit(current)} disabled={!!busy || !data?.controls_enabled}><Icon name="settings" />Edit Target</button>
            <button type="button" class="button button-close" on:click={() => askDelete(current)} disabled={!!busy || !data?.controls_enabled}><Icon name="trash" />Delete Target</button>
          {/if}
          <button type="button" class="button button-primary" on:click={() => runTarget(current)} disabled={!!busy || !data?.controls_enabled}><Icon name="play" />Run Target</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <caption class="sr-only">Jobs for {current.name}</caption>
          <thead><tr><th>Backup Job</th><th>Status</th><th>Last run</th><th>Duration</th><th>Size</th><th>Archive</th><th>Message</th><th>Actions</th></tr></thead>
          <tbody>
            {#each jobsOf(current) as job (job.key)}
              <tr>
                <td><strong>{jobLabel(job.job)}</strong><small class="backup-job-key">{job.key}</small></td>
                <td><span class={`status-pill ${statusPill(job.status)}`}><Icon name={statusIcon(job.status)} />{job.status}</span></td>
                <td>{formatRunTime(job.last_run)}</td>
                <td>{job.duration_fmt || "—"}</td>
                <td>{job.size || "—"}</td>
                <td class="backup-archive">{job.archive || "—"}</td>
                <td>{job.is_running ? job.running_phase || "Running" : job.message || "—"}</td>
                <td>
                  <div class="backup-row-actions">
                    {#if job.is_running}
                      <button type="button" class="button button-close" on:click={() => askStop(job)} disabled={!!busy || !data?.controls_enabled}><Icon name="stop" />Stop</button>
                    {:else}
                      <button type="button" class="button button-secondary" on:click={() => runJob(job)} disabled={!!busy || !data?.controls_enabled}><Icon name="play" />Run</button>
                    {/if}
                    <button type="button" class="button button-secondary" on:click={() => openLog(`${jobLabel(job.job)} (${job.target})`, job.log_path, unitFor(job), job.log_path ? "file" : "journal")}><Icon name="terminal" />View Log</button>
                  </div>
                </td>
              </tr>
            {:else}
              <tr><td colspan="8">No jobs recorded for this target.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <section class="panel backup-activity" aria-labelledby="backup-activity-title">
    <div class="panel-heading"><div><h2 id="backup-activity-title">Recent activity</h2><p>Who ran, registered, or changed backup settings.</p></div></div>
    {#if activity.length}
      <div class="backup-activity-list">
        {#each activity as item (item.id)}
          <div><strong>{item.actor}</strong> · {item.action.replaceAll("_", " ")} <span class="status-pill pill-neutral">{item.target}</span><small>{time(item.at)} · {item.detail}</small></div>
        {/each}
      </div>
    {:else}
      <div class="empty-state"><p>No backup activity recorded yet.</p></div>
    {/if}
  </section>
{:else if tab === "logs"}
  <section class="panel backup-logs" aria-labelledby="backup-logs-title">
    <div class="panel-heading">
      <div><h2 id="backup-logs-title">Logs & failures</h2><p>Read recent job logs, failures.log, or journald output.</p></div>
      <div class="backup-log-toolbar">
        <button type="button" class="button button-secondary" on:click={() => loadLogs(logSelection)} disabled={logsBusy}><Icon name="refresh" />Refresh</button>
        <button type="button" class="button button-close" on:click={askClearFailures} disabled={!data?.controls_enabled}><Icon name="trash" />Clear failures.log</button>
      </div>
    </div>
    <div class="backup-log-layout">
      <div class="backup-log-list">
        <button type="button" class="backup-log-item" class:active={logSelection === "failures"} on:click={() => loadLogs("failures")}><Icon name="alert" /><span>failures.log<small>Recent backup failures</small></span></button>
        <button type="button" class="backup-log-item" class:active={logSelection === "journal"} on:click={() => loadLogs("journal")}><Icon name="terminal" /><span>journald<small>Host backup journal</small></span></button>
        {#each logFiles.filter((file) => file.name !== "failures.log") as file (file.path)}
          <button type="button" class="backup-log-item" class:active={logSelection === file.path} on:click={() => loadLogs(file.path)}><Icon name="terminal" /><span>{file.name}<small>{file.size} · {file.mtime}</small></span></button>
        {/each}
      </div>
      <div class="backup-log-view">
        {#if logsError}<p class="field-error" role="alert">{logsError}</p>{/if}
        <pre class="backup-log-output">{logsText || (logsBusy ? "Loading log…" : "No log content.")}</pre>
      </div>
    </div>
  </section>
{:else}
  <section class="panel backup-settings" aria-labelledby="backup-settings-title">
    <div class="panel-heading">
      <div><h2 id="backup-settings-title">Settings & tools</h2><p>Edit global backup configuration or run maintenance tools.</p></div>
      <button type="button" class="button button-secondary" on:click={loadConfigs} disabled={configsBusy}><Icon name="refresh" />Refresh</button>
    </div>
    {#if configsError}<p class="field-error" role="alert">{configsError}</p>{/if}
    <div class="backup-config-layout">
      <div class="backup-config-form">
        <label for="backup-config">Configuration file<select id="backup-config" bind:value={configId} on:change={chooseConfig}>{#each configs as config (config.id)}<option value={config.id}>{config.label}</option>{/each}</select></label>
        {#if currentConfig}<p class="input-help">{currentConfig.path}</p>{/if}
        <label for="backup-config-text">File contents<textarea id="backup-config-text" class="backup-config-textarea" bind:value={configContent} spellcheck="false"></textarea></label>
        <div class="backup-config-actions"><button type="button" class="button button-primary" on:click={saveConfig} disabled={configsBusy || !data?.controls_enabled}><Icon name="check" />Save configuration</button></div>
      </div>
      <aside class="backup-tools">
        <h3>Tools</h3>
        <button type="button" class="button button-secondary" on:click={testNotify} disabled={!!busy || !data?.controls_enabled}><Icon name="shield" />Test Alert</button>
        <button type="button" class="button button-secondary" on:click={askRebuild} disabled={!!busy || !data?.controls_enabled}><Icon name="refresh" />Rebuild FAST Manifest</button>
        <button type="button" class="button button-secondary" on:click={openPreflight}><Icon name="shield" />Preflight Check</button>
        <p class="input-help">Test Alert sends a notification through notify.conf. Rebuilding the manifest clears the FAST station cache.</p>
      </aside>
    </div>
  </section>
{/if}

<dialog class="backup-dialog-wide" bind:this={targetDialog} aria-labelledby="backup-target-dialog-title">
  <form class="dialog-content backup-form-dialog" on:submit|preventDefault={saveTarget}>
    <span class="dialog-icon"><Icon name={form.editing ? "settings" : "plus"} /></span>
    <h2 id="backup-target-dialog-title">{form.editing ? `Edit target · ${form.name}` : "Register backup target"}</h2>
    <p>{form.editing ? "Update the destination IP, SMB login, or backup schedule for this target." : "Add a new SMB destination PC. FAST System, System3, and SQL Backups will run on your chosen schedule."}</p>
    {#if formError}<p class="field-error" role="alert">{formError}</p>{/if}

    <div class="backup-form-section">
      <h3>Destination</h3>
      <div class="backup-form-grid">
        <label for="target-name">Target name<input id="target-name" type="text" bind:value={form.name} disabled={form.editing} placeholder="e.g. office2" maxlength="24" required /></label>
        <label for="target-ip">Destination IP or hostname<input id="target-ip" type="text" bind:value={form.dest_ip} placeholder="e.g. 192.168.0.50" required /></label>
      </div>
    </div>

    <div class="backup-form-section">
      <h3>SMB Credentials</h3>
      {#if form.editing}
        <label class="backup-check"><input type="checkbox" bind:checked={form.keep_cred} />Keep existing saved credentials</label>
      {/if}
      {#if !form.editing || !form.keep_cred}
        <div class="backup-form-grid">
          <label for="target-user">SMB username<input id="target-user" type="text" bind:value={form.username} placeholder="e.g. Administrator" autocomplete="username" required={!form.keep_cred} /></label>
          <label for="target-domain">Domain (optional)<input id="target-domain" type="text" bind:value={form.domain} placeholder="WORKGROUP" autocomplete="off" /></label>
        </div>
        <label for="target-password">
          SMB password
          <div class="password-field">
            {#if showPassword}
              <input id="target-password" type="text" bind:value={form.password} placeholder="Leave blank if share has no password" autocomplete="new-password" />
            {:else}
              <input id="target-password" type="password" bind:value={form.password} placeholder="Leave blank if share has no password" autocomplete="new-password" />
            {/if}
            <button type="button" class="password-toggle" on:click={() => (showPassword = !showPassword)}>{showPassword ? "Hide" : "Show"}</button>
          </div>
        </label>
      {/if}
    </div>

    <div class="backup-form-section">
      <h3>Backup Schedule</h3>
      <SchedulePicker
        bind:value={form.schedule}
        bind:validation={formCheck}
        validating={formCheckBusy}
        onValidate={validateFormSchedule}
      />
      <label class="backup-check"><input type="checkbox" bind:checked={form.enabled} />Enable automatic scheduled backups</label>
    </div>

    <div class="dialog-actions"><button type="button" class="button button-secondary" on:click={() => targetDialog.close()} disabled={formBusy}>Cancel</button><button type="submit" class="button button-primary" disabled={formBusy}>{formBusy ? "Saving…" : form.editing ? "Save changes" : "Register target"}</button></div>
  </form>
</dialog>

<dialog class="backup-dialog-wide" bind:this={scheduleDialog} aria-labelledby="backup-schedule-title">
  <form class="dialog-content backup-form-dialog" on:submit|preventDefault={saveSchedule}>
    <span class="dialog-icon"><Icon name="calendar" /></span>
    <h2 id="backup-schedule-title">Edit schedule{scheduleTarget ? ` · ${scheduleTarget.name}` : ""}</h2>
    <p>Choose which days and times {scheduleTarget?.name || "this target"} should run automatically.</p>
    {#if scheduleError}<p class="field-error" role="alert">{scheduleError}</p>{/if}
    <div class="backup-form-section">
      <SchedulePicker
        bind:value={scheduleValue}
        bind:validation={scheduleCheck}
        validating={scheduleCheckBusy}
        onValidate={validateTimerSchedule}
      />
    </div>
    <div class="dialog-actions"><button type="button" class="button button-secondary" on:click={() => scheduleDialog.close()} disabled={scheduleBusy}>Cancel</button><button type="submit" class="button button-primary" disabled={scheduleBusy}>{scheduleBusy ? "Saving…" : "Save schedule"}</button></div>
  </form>
</dialog>

<dialog class="backup-dialog-wide" bind:this={logDialog} on:close={closeLog} aria-labelledby="backup-log-title">
  <div class="dialog-content backup-log-dialog">
    <span class="dialog-icon"><Icon name="terminal" /></span>
    <h2 id="backup-log-title">{logTitle}</h2>
    <div class="backup-log-tabs" role="group" aria-label="Log source">
      <button type="button" class="button button-secondary" class:active={logMode === "file"} on:click={() => setLogMode("file")}>Job log file</button>
      <button type="button" class="button button-secondary" class:active={logMode === "journal"} on:click={() => setLogMode("journal")}>Journald</button>
      <span class="live-label"><span class="status-dot"></span>Auto-refresh 2.5s</span>
    </div>
    {#if logError}<p class="field-error" role="alert">{logError}</p>{/if}
    <pre class="backup-log-output">{logText || (logBusy ? "Loading log…" : "No log content.")}</pre>
    <div class="dialog-actions"><button type="button" class="button button-secondary" on:click={() => logDialog.close()}>Close</button></div>
  </div>
</dialog>

<dialog class="backup-dialog-wide" bind:this={preflightDialog} aria-labelledby="backup-preflight-title">
  <div class="dialog-content backup-preflight-dialog">
    <span class="dialog-icon"><Icon name="shield" /></span>
    <h2 id="backup-preflight-title">Preflight check</h2>
    <p>Verify mounts, storage, tools, and notification readiness before running backups.</p>
    {#if preflightError}<p class="field-error" role="alert">{preflightError}</p>{/if}
    <div class="table-wrap">
      <table class="backup-preflight-table">
        <caption class="sr-only">Backup preflight checks</caption>
        <thead><tr><th>Category</th><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
        <tbody>
          {#each preflight?.items || [] as item (item.category + item.name)}
            <tr><td>{item.category}</td><td><strong>{item.name}</strong></td><td><span class={`status-pill ${item.ok ? "pill-success" : "pill-warning"}`}><Icon name={item.ok ? "check" : "alert"} />{item.ok ? "Pass" : "Attention"}</span></td><td>{item.detail}</td></tr>
          {:else}
            <tr><td colspan="4">{preflightBusy ? "Running checks…" : "No checks returned."}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="dialog-actions"><button type="button" class="button button-secondary" on:click={() => preflightDialog.close()}>Close</button><button type="button" class="button button-primary" on:click={loadPreflight} disabled={preflightBusy}><Icon name="refresh" />Re-run</button></div>
  </div>
</dialog>

<dialog bind:this={confirmDialog} on:close={() => (confirm = null)} aria-labelledby="backup-confirm-title">
  <div class="dialog-content">
    <span class="dialog-icon"><Icon name="alert" /></span>
    <h2 id="backup-confirm-title">{confirm?.title || "Confirm action"}</h2>
    <p>{confirm?.message || ""}</p>
    <div class="dialog-actions"><button type="button" class="button button-secondary" on:click={() => confirmDialog.close()} disabled={confirmBusy}>Cancel</button><button type="button" class={`button ${confirm?.danger ? "button-danger" : "button-primary"}`} on:click={runConfirm} disabled={confirmBusy}>{confirmBusy ? "Working…" : confirm?.label || "Confirm"}</button></div>
  </div>
</dialog>
