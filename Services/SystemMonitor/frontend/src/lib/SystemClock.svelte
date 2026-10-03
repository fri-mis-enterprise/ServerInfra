<script>
  import { onMount } from "svelte";
  import { auth, api, time } from "./state";
  import { get } from "svelte/store";
  import Icon from "./Icon.svelte";
  let display = "";
  let note = "All deadlines follow this clock";
  onMount(() => {
    let stopped = false;
    let sample = Date.parse(get(auth).server_time);
    let sampledAt = performance.now();
    function update() {
      display = time(
        new Date(sample + performance.now() - sampledAt).toISOString(),
        true,
      );
    }
    async function sync() {
      try {
        const result = await api("/time");
        if (stopped) return;
        sample = Date.parse(result.server_time);
        sampledAt = performance.now();
        note = "All deadlines follow this clock";
        update();
      } catch {
        if (!stopped) note = "Clock sync delayed — retrying";
      }
    }
    update();
    const timer = setInterval(update, 1000);
    const resync = setInterval(sync, 60000);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(resync);
    };
  });
</script>

<div class="system-clock">
  <Icon name="clock" />
  <div>
    <span class="clock-label">System time · Manila</span><time id="system-time"
      >{display}</time
    ><span class="clock-note">{note}</span>
  </div>
</div>
