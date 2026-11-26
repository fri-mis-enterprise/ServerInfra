<script lang="ts">
  import { getAlerts, removeAlert } from "../stores/ui.svelte";
  import { XCircle, CheckCircle, AlertTriangle, Info, X } from "lucide-svelte";

  let alerts = $derived(getAlerts());
</script>

<div class="toast toast-top toast-center z-[100] w-full max-w-md">
  {#each alerts as alert (alert.id)}
    <div
      class="alert shadow-lg flex justify-between items-center"
      class:alert-error={alert.type === 'error'}
      class:alert-success={alert.type === 'success'}
      class:alert-warning={alert.type === 'warning'}
      class:alert-info={alert.type === 'info'}
    >
      <div class="flex items-center gap-2">
        {#if alert.type === 'error'} <XCircle size={20} /> {/if}
        {#if alert.type === 'success'} <CheckCircle size={20} /> {/if}
        {#if alert.type === 'warning'} <AlertTriangle size={20} /> {/if}
        {#if alert.type === 'info'} <Info size={20} /> {/if}
        <span>{alert.message}</span>
      </div>
      <button class="btn btn-ghost btn-xs" onclick={() => removeAlert(alert.id)}>
        <X size={16} />
      </button>
    </div>
  {/each}
</div>
