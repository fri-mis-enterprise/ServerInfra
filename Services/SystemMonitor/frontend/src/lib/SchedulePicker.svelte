<script>
  import Icon from "$lib/Icon.svelte";
  import {
    DAYS,
    buildOnCalendar,
    formatDaysHuman,
    formatTime12h,
    parseOnCalendar,
  } from "$lib/schedule";

  export let value = "Mon..Sat 08:00:00";
  export let validation = null;
  export let validating = false;
  export let onValidate = null;

  let days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let times = ["08:00"];
  let timezone = "";
  let customMode = false;
  let newTime = "13:00";
  let minuteNote = "";
  let lastSynced = "";

  $: if (value !== lastSynced) {
    syncFromValue(value);
  }

  function syncFromValue(expr) {
    lastSynced = expr || "";
    const parsed = parseOnCalendar(expr);
    if (parsed.supported) {
      days = parsed.days;
      times = parsed.times;
      timezone = parsed.timezone;
      customMode = false;
      minuteNote = "";
    } else {
      customMode = true;
    }
  }

  function commitVisual() {
    const built = buildOnCalendar(days, times, timezone);
    if (built) {
      lastSynced = built;
      value = built;
      validation = null;
    }
  }

  function applyPreset(preset) {
    customMode = false;
    if (preset === "daily") days = DAYS.map((d) => d.key);
    else if (preset === "monsat") days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    else if (preset === "weekdays") days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    else if (preset === "sunday") days = ["Sun"];
    commitVisual();
  }

  function toggleDay(dayKey) {
    customMode = false;
    if (days.includes(dayKey)) {
      if (days.length === 1) return; // keep at least one day
      days = days.filter((d) => d !== dayKey);
    } else {
      days = DAYS.map((d) => d.key).filter((k) => days.includes(k) || k === dayKey);
    }
    commitVisual();
  }

  function addTime() {
    if (!/^\d{2}:\d{2}$/.test(newTime)) return;
    customMode = false;
    minuteNote = "";
    const targetMin = newTime.slice(3, 5);
    if (times.length > 0 && times[0].slice(3, 5) !== targetMin) {
      // Align existing times to the newly chosen minute or warn cleanly
      minuteNote = `Multiple daily runs share the same minute (:${times[0].slice(3, 5)}). Added at ${newTime.slice(0, 2)}:${times[0].slice(3, 5)}.`;
      const aligned = `${newTime.slice(0, 2)}:${times[0].slice(3, 5)}`;
      times = Array.from(new Set([...times, aligned])).sort();
    } else {
      times = Array.from(new Set([...times, newTime])).sort();
    }
    commitVisual();
  }

  function removeTime(t) {
    if (times.length <= 1) return;
    minuteNote = "";
    times = times.filter((item) => item !== t);
    commitVisual();
  }

  function onAdvancedInput(event) {
    value = event.currentTarget.value;
    validation = null;
    const parsed = parseOnCalendar(value);
    if (parsed.supported) {
      days = parsed.days;
      times = parsed.times;
      timezone = parsed.timezone;
      customMode = false;
      lastSynced = value;
    } else {
      customMode = true;
      lastSynced = value;
    }
  }

  $: summaryText = customMode
    ? `Custom schedule: ${value || "—"}`
    : `Runs ${formatDaysHuman(days)} at ${times.map(formatTime12h).join(", ")}${timezone ? ` (${timezone})` : ""}`;
</script>

<div class="schedule-picker">
  <div class="schedule-block">
    <div class="schedule-row-head">
      <span class="schedule-label">Backup days</span>
      <div class="schedule-presets" role="group" aria-label="Day presets">
        <button type="button" class="schedule-preset" on:click={() => applyPreset("monsat")}>Mon–Sat</button>
        <button type="button" class="schedule-preset" on:click={() => applyPreset("daily")}>Every day</button>
        <button type="button" class="schedule-preset" on:click={() => applyPreset("weekdays")}>Mon–Fri</button>
        <button type="button" class="schedule-preset" on:click={() => applyPreset("sunday")}>Sun only</button>
      </div>
    </div>
    <div class="schedule-days" role="group" aria-label="Select days of week">
      {#each DAYS as day (day.key)}
        <button
          type="button"
          class="day-pill"
          class:active={!customMode && days.includes(day.key)}
          aria-pressed={!customMode && days.includes(day.key)}
          on:click={() => toggleDay(day.key)}
        >
          {day.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="schedule-block">
    <span class="schedule-label">Run time{times.length === 1 ? "" : "s"} (Asia/Manila)</span>
    <div class="schedule-times-list">
      {#each times as t (t)}
        <span class="time-chip">
          <Icon name="clock" />
          {formatTime12h(t)}
          {#if times.length > 1}
            <button type="button" class="time-chip-remove" aria-label={`Remove ${formatTime12h(t)}`} on:click={() => removeTime(t)}>
              <Icon name="close" />
            </button>
          {/if}
        </span>
      {/each}
    </div>
    <div class="schedule-add-time">
      <input type="time" bind:value={newTime} aria-label="Add backup run time" />
      <button type="button" class="button button-secondary" on:click={addTime}><Icon name="plus" />Add time</button>
    </div>
    {#if minuteNote}<p class="input-help">{minuteNote}</p>{/if}
  </div>

  <div class="schedule-summary">
    <div class="schedule-summary-text">
      <Icon name="calendar" />
      <span>{summaryText}</span>
    </div>
    {#if onValidate}
      <button type="button" class="button button-secondary" on:click={onValidate} disabled={validating}>
        {validating ? "Checking…" : "Check next run"}
      </button>
    {/if}
  </div>

  {#if validation}
    <div class="schedule-validation">
      <span class={`status-pill ${validation.valid ? "pill-success" : "pill-warning"}`}>
        <Icon name={validation.valid ? "check" : "alert"} />
        {validation.detail}
      </span>
    </div>
  {/if}

  <details class="schedule-advanced" open={customMode}>
    <summary>Advanced systemd expression (<code>{value || "—"}</code>)</summary>
    <label>
      OnCalendar expression
      <input type="text" value={value} on:input={onAdvancedInput} placeholder="Mon..Sat 08,13,17:00:00" required />
    </label>
  </details>
</div>
